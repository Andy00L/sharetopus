import "server-only";

import { randomUUID } from "node:crypto";
import { isAddress } from "@solana/kit";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { directPostBatch } from "@/actions/server/directPostActions/directPostBatch";
import type { DirectPostData } from "@/actions/server/directPostActions/directPostBatch";
import { resolveExistingWalletPrincipal } from "@/lib/x402/auth/resolveOrOnboardWalletPrincipal";
import type { WalletPrincipal } from "@/lib/x402/auth/types";
import {
  markChargeFailed,
  markChargeRefunded,
  markChargeSettled,
} from "@/lib/x402/charges/chargeTransitions";
import { insertPendingX402Charge } from "@/lib/x402/charges/insertPendingX402Charge";
import { recordX402Reconciliation } from "@/lib/x402/charges/recordReconciliation";
import { getBaseUrl, getRecipientAddress, isX402Platform } from "@/lib/x402/config";
import type { Platform } from "@/lib/x402/connect/types";
import { refundPayment } from "@/lib/x402/facilitator";
import { NETWORKS } from "@/lib/x402/networks";
import { readActionPrice } from "@/lib/x402/pricing/readActionPrice";
import { buildSolanaExplorerTxUrl } from "@/lib/x402/solana/explorer";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";
import { buildUsdcPaymentTransaction } from "./buildUsdcPaymentTransaction";
import { verifyUsdcPayment } from "./verifyUsdcPayment";

/**
 * The post-now Blink: a Solana Action that publishes a text post to one of
 * the wallet's connected social accounts for the post.text price, paid in
 * USDC straight from the wallet.
 *
 * Three steps, one per route handler:
 *   describe  GET  /api/actions/post-now?account_id&platform
 *             The card a Blink client renders: price, one text field.
 *   prepare   POST /api/actions/post-now?account_id&platform&text  {account}
 *             Checks the wallet is known and owns the account, then returns
 *             the unsigned USDC payment for the wallet to sign and send.
 *   confirm   POST /api/actions/post-now/confirm?...  {account, signature}
 *             Verifies the payment on-chain, records the charge exactly like
 *             the x402 middleware (pending, settled, then the post), refunds
 *             on a post failure, and returns the explorer link.
 *
 * Why the wallet pays directly: a Blink client signs and broadcasts the
 * transaction itself, so the x402 facilitator (which co-signs as fee payer)
 * cannot sit in the middle. Verification therefore happens here against the
 * chain, and x402_charges.facilitator records "solana_direct".
 *
 * Called by: src/app/api/actions/post-now/route.ts, .../confirm/route.ts
 * Tables touched: social_accounts (read), x402_charges (insert, update),
 *                 x402_refunds, x402_reconciliation (via helpers)
 */

/** Pricing action the Blink sells. sourceRef: middleware/resolvePostAction.ts */
const BLINK_ACTION = "post.text";

/** Post body ceiling. LinkedIn caps a post at 3000 characters, the tightest of the supported platforms. */
const MAX_POST_TEXT_LENGTH = 3000;

/** x402_charges.facilitator label: the wallet broadcast the payment itself. */
const DIRECT_SOLANA_FACILITATOR = "solana_direct";

/** social_accounts.id is a UUID; anything else is rejected before any query. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Module-load assertion, same pattern as networks.ts for "base".
if (!NETWORKS.solana) {
  throw new Error(
    "[postNowBlink] Solana entry missing from NETWORKS. This is a build-time configuration error.",
  );
}
const SOLANA_NETWORK = NETWORKS.solana;

export interface PostNowBlinkTarget {
  accountId: string;
  platform: Platform;
}

export type BlinkFailure = {
  ok: false;
  httpStatus: number;
  message: string;
  refundTxHash?: string | null;
};

/** The GET body per @solana/actions-spec v2.4.2 (Action with one linked action). */
export interface PostNowActionCard {
  type: "action";
  icon: string;
  title: string;
  description: string;
  label: string;
  disabled?: boolean;
  error?: { message: string };
  links?: {
    actions: {
      type: "transaction";
      href: string;
      label: string;
      parameters: {
        type: "textarea";
        name: string;
        label: string;
        required: true;
        max: number;
      }[];
    }[];
  };
}

export function parseBlinkTarget(
  searchParams: URLSearchParams,
): { ok: true; target: PostNowBlinkTarget } | BlinkFailure {
  const accountId = searchParams.get("account_id") ?? "";
  const platform = searchParams.get("platform") ?? "";
  if (!UUID_PATTERN.test(accountId)) {
    return { ok: false, httpStatus: 400, message: "account_id must be the UUID of a connected social account." };
  }
  if (!isX402Platform(platform)) {
    return { ok: false, httpStatus: 400, message: `platform "${platform}" is not supported.` };
  }
  return { ok: true, target: { accountId, platform } };
}

export function parseBlinkText(
  searchParams: URLSearchParams,
): { ok: true; text: string } | BlinkFailure {
  const text = (searchParams.get("text") ?? "").trim();
  if (text.length === 0) {
    return { ok: false, httpStatus: 400, message: "text is required." };
  }
  if (text.length > MAX_POST_TEXT_LENGTH) {
    return {
      ok: false,
      httpStatus: 400,
      message: `text is ${text.length} characters; the limit is ${MAX_POST_TEXT_LENGTH}.`,
    };
  }
  return { ok: true, text };
}

export async function describePostNowAction(
  target: PostNowBlinkTarget,
): Promise<PostNowActionCard> {
  const priceResult = await readActionPrice(BLINK_ACTION);
  const iconUrl = `${getBaseUrl()}/logo.png`;
  const title = `Post to ${target.platform} with Sharetopus`;

  if (!priceResult.ok) {
    return {
      type: "action",
      icon: iconUrl,
      title,
      description: "Pricing is unavailable right now. Try again in a minute.",
      label: "Unavailable",
      disabled: true,
      error: { message: priceResult.message },
    };
  }

  const priceLabel = formatUsdcLabel(priceResult.usdcPrice);
  const prepareHref = buildActionPath("/api/actions/post-now", target, "{text}");
  return {
    type: "action",
    icon: iconUrl,
    title,
    description: `Publishes a text post to the connected ${target.platform} account. ${priceLabel} on Solana, paid from your wallet; the post goes live once the payment confirms.`,
    label: `Post for ${priceLabel}`,
    links: {
      actions: [
        {
          type: "transaction",
          href: prepareHref,
          label: `Post for ${priceLabel}`,
          parameters: [
            {
              type: "textarea",
              name: "text",
              label: "What to post",
              required: true,
              max: MAX_POST_TEXT_LENGTH,
            },
          ],
        },
      ],
    },
  };
}

export type PreparePostNowPaymentResult =
  | { ok: true; transactionBase64: string; message: string; confirmHref: string }
  | BlinkFailure;

export async function preparePostNowPayment(params: {
  target: PostNowBlinkTarget;
  text: string;
  payerAddressRaw: string;
}): Promise<PreparePostNowPaymentResult> {
  if (!isAddress(params.payerAddressRaw)) {
    return { ok: false, httpStatus: 400, message: "account is not a valid Solana address." };
  }

  const walletResult = await resolveWalletForBlink(params.payerAddressRaw);
  if (!walletResult.ok) return walletResult;

  const ownership = await checkAccountOwnership(walletResult.principal, params.target);
  if (!ownership.ok) return ownership;

  const priceResult = await readActionPrice(BLINK_ACTION);
  if (!priceResult.ok) {
    return { ok: false, httpStatus: 503, message: "Pricing is unavailable right now." };
  }

  const recipientAddress = getRecipientAddress(SOLANA_NETWORK);
  if (!recipientAddress) {
    console.error("[preparePostNowPayment] X402_RECIPIENT_SOLANA is not set.");
    return { ok: false, httpStatus: 500, message: "Solana payments are not configured." };
  }

  const transactionResult = await buildUsdcPaymentTransaction({
    payerAddress: params.payerAddressRaw,
    recipientAddress,
    amountUsdc: priceResult.usdcPrice,
    network: SOLANA_NETWORK,
  });
  if (!transactionResult.ok) {
    return { ok: false, httpStatus: 503, message: "Could not reach Solana to prepare the payment. Try again." };
  }

  return {
    ok: true,
    transactionBase64: transactionResult.transactionBase64,
    message: `Paying ${formatUsdcLabel(priceResult.usdcPrice)}. Your post publishes once the payment confirms.`,
    confirmHref: buildActionPath("/api/actions/post-now/confirm", params.target, params.text),
  };
}

export type ConfirmPostNowPaymentResult =
  | { ok: true; txSignature: string; explorerUrl: string; batchId: string }
  | BlinkFailure;

export async function confirmPostNowPayment(params: {
  target: PostNowBlinkTarget;
  text: string;
  payerAddressRaw: string;
  txSignatureRaw: string;
}): Promise<ConfirmPostNowPaymentResult> {
  if (!isAddress(params.payerAddressRaw)) {
    return { ok: false, httpStatus: 400, message: "account is not a valid Solana address." };
  }

  const priceResult = await readActionPrice(BLINK_ACTION);
  if (!priceResult.ok) {
    return { ok: false, httpStatus: 503, message: "Pricing is unavailable right now." };
  }
  const recipientAddress = getRecipientAddress(SOLANA_NETWORK);
  if (!recipientAddress) {
    console.error("[confirmPostNowPayment] X402_RECIPIENT_SOLANA is not set.");
    return { ok: false, httpStatus: 500, message: "Solana payments are not configured." };
  }

  // Step 1: the chain is the source of truth for the payment.
  const verification = await verifyUsdcPayment({
    txSignatureRaw: params.txSignatureRaw,
    expectedPayerAddress: params.payerAddressRaw,
    recipientAddress,
    usdcMint: SOLANA_NETWORK.usdcAddress,
    minimumAtomicAmount: BigInt(
      usdcToAtomic(priceResult.usdcPrice, SOLANA_NETWORK.usdcDecimals),
    ),
    network: SOLANA_NETWORK,
  });
  if (!verification.ok) {
    return {
      ok: false,
      httpStatus: mapVerificationStatus(verification.reason),
      message: verification.message,
    };
  }

  // Step 2: the payer must be a wallet Sharetopus already knows. Money has
  // moved by now, so an unknown or sanctioned payer is recorded for manual
  // reconciliation instead of being refunded blindly.
  const walletResult = await resolveWalletForBlink(verification.payerAddress);
  if (!walletResult.ok) {
    await recordX402Reconciliation({
      kind: "settle_unrecorded",
      txHash: verification.txSignature,
      payerAddress: verification.payerAddress,
      amountAtomic: verification.atomicReceived.toString(),
      network: SOLANA_NETWORK.name,
    });
    return walletResult;
  }
  const principal = walletResult.principal;

  // Step 3: the charge row, nonce = signature, before anything else happens.
  // A second confirm with the same signature loses the UNIQUE race here.
  const requestId = randomUUID();
  const chargeInsert = await insertPendingX402Charge({
    principalId: principal.principalId,
    walletId: principal.walletId,
    action: BLINK_ACTION,
    amountUsdc: priceResult.usdcPrice,
    amountUsdAtReceipt: null,
    network: SOLANA_NETWORK.name,
    nonce: verification.txSignature,
    requestId,
    payerAddress: verification.payerAddress,
    recipientAddress,
    facilitator: DIRECT_SOLANA_FACILITATOR,
  });
  if (!chargeInsert.success) {
    const isReplay = chargeInsert.conflictReason === "nonce_used";
    return {
      ok: false,
      httpStatus: isReplay ? 409 : 500,
      message: isReplay
        ? "This payment was already used for a post."
        : "The payment could not be recorded. Support has been notified; do not pay again.",
    };
  }
  const chargeId = chargeInsert.chargeId;

  // Step 4: pending -> settled with the on-chain facts.
  const settledTransition = await markChargeSettled({
    chargeId,
    txHash: verification.txSignature,
    blockNumber: Number(verification.slot),
    facilitatorFeeUsdc: null,
    settledAt:
      verification.blockTimeUnixSeconds !== null
        ? new Date(Number(verification.blockTimeUnixSeconds) * 1000).toISOString()
        : new Date().toISOString(),
  });
  if (!settledTransition.success) {
    console.error(
      `[confirmPostNowPayment] CHARGE RECONCILIATION NEEDED: charge ${chargeId} settled on-chain (tx ${verification.txSignature}) but could not transition to settled: ${settledTransition.message}`,
    );
    await recordX402Reconciliation({
      kind: "settle_unrecorded",
      chargeId,
      txHash: verification.txSignature,
      payerAddress: verification.payerAddress,
      network: SOLANA_NETWORK.name,
    });
    return {
      ok: false,
      httpStatus: 500,
      message: "Payment settled but could not be recorded. Support has been notified; do not pay again.",
    };
  }

  // Step 5: the paid action. Any failure from here is refundable.
  const ownership = await checkAccountOwnership(principal, params.target);
  if (!ownership.ok) {
    return refundAndFail({
      chargeId,
      txSignature: verification.txSignature,
      payerAddress: verification.payerAddress,
      amountUsdc: priceResult.usdcPrice,
      principalId: principal.principalId,
      httpStatus: ownership.httpStatus,
      reason: ownership.message,
    });
  }

  const directPost: DirectPostData = {
    socialAccountId: params.target.accountId,
    platform: params.target.platform,
    postType: "text",
    description: params.text,
    mediaStoragePath: "",
    title: undefined,
    coverTimestamp: undefined,
    pinterestBoardId: undefined,
    pinterestBoardName: undefined,
    pinterestLink: undefined,
    // One post per payment even if the client retries confirm.
    idempotency_key: `blink:${verification.txSignature}`,
  };
  const batchResult = await directPostBatch(
    [directPost],
    principal.principalId,
    "x402",
    undefined,
    requestId,
  );
  if (!batchResult.success) {
    return refundAndFail({
      chargeId,
      txSignature: verification.txSignature,
      payerAddress: verification.payerAddress,
      amountUsdc: priceResult.usdcPrice,
      principalId: principal.principalId,
      httpStatus: 500,
      reason: batchResult.message,
    });
  }

  // Same link the x402 post-now route stores, so the proof ledger resolves
  // this settlement's outcome the same way.
  const { error: linkError } = await adminSupabase
    .from("x402_charges")
    .update({ metadata: { batch_id: batchResult.batchId } })
    .eq("id", chargeId);
  if (linkError) {
    console.error(
      `[confirmPostNowPayment] Failed to link charge ${chargeId} to batch ${batchResult.batchId}: ${linkError.message}`,
    );
  }

  return {
    ok: true,
    txSignature: verification.txSignature,
    explorerUrl: buildSolanaExplorerTxUrl(verification.txSignature),
    batchId: batchResult.batchId,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function resolveWalletForBlink(
  payerAddress: string,
): Promise<{ ok: true; principal: WalletPrincipal } | BlinkFailure> {
  const walletResult = await resolveExistingWalletPrincipal(payerAddress);
  if (walletResult.ok) return { ok: true, principal: walletResult.principal };
  switch (walletResult.reason) {
    case "unknown_wallet":
      return {
        ok: false,
        httpStatus: 403,
        message:
          "This wallet has not paid Sharetopus before. Connect an account through x402 first (see sharetopus.com/solana).",
      };
    case "sanctioned":
      return { ok: false, httpStatus: 403, message: walletResult.message };
    case "db_error":
      return { ok: false, httpStatus: 500, message: walletResult.message };
  }
}

/** The account must belong to the paying wallet's principal, on that platform, and not be deleted. */
async function checkAccountOwnership(
  principal: WalletPrincipal,
  target: PostNowBlinkTarget,
): Promise<{ ok: true } | BlinkFailure> {
  const { data: account, error } = await adminSupabase
    .from("social_accounts")
    .select("id")
    .eq("id", target.accountId)
    .eq("principal_id", principal.principalId)
    .eq("platform", target.platform)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error(`[checkAccountOwnership] social_accounts read failed: ${error.message}`);
    return { ok: false, httpStatus: 500, message: "Could not verify the account." };
  }
  if (!account) {
    return {
      ok: false,
      httpStatus: 404,
      message: `No connected ${target.platform} account with that id belongs to this wallet.`,
    };
  }
  return { ok: true };
}

/**
 * Mirrors the x402 middleware's refundable-failure step: refund on-chain
 * first, then record it; when the refund fails, flag the charge for manual
 * reconciliation. Always resolves to the failure the client should see.
 */
async function refundAndFail(params: {
  chargeId: string;
  txSignature: string;
  payerAddress: string;
  amountUsdc: number;
  principalId: string;
  httpStatus: number;
  reason: string;
}): Promise<BlinkFailure> {
  const refundResult = await refundPayment({
    originalTxHash: params.txSignature,
    payerAddress: params.payerAddress,
    amountUsdc: params.amountUsdc,
    network: SOLANA_NETWORK,
    reason: params.reason,
  });

  if (refundResult.ok) {
    const refundedTransition = await markChargeRefunded({
      chargeId: params.chargeId,
      reason: params.reason,
      refundedUsdc: params.amountUsdc,
      refundTxHash: refundResult.refundTxHash,
      initiatedBy: params.principalId,
    });
    if (!refundedTransition.success) {
      console.error(
        `[refundAndFail] CHARGE RECONCILIATION NEEDED: charge ${params.chargeId} refunded on-chain (refund tx ${refundResult.refundTxHash}) but could not be recorded: ${refundedTransition.message}`,
      );
    }
    return {
      ok: false,
      httpStatus: params.httpStatus,
      message: `${params.reason} Your payment was refunded.`,
      refundTxHash: refundResult.refundTxHash,
    };
  }

  console.error(
    `[refundAndFail] REFUND FAILED for charge ${params.chargeId} (settle tx ${params.txSignature}): ${refundResult.error.message}`,
  );
  await recordX402Reconciliation({
    kind: "refund_failed",
    chargeId: params.chargeId,
    txHash: params.txSignature,
    payerAddress: params.payerAddress,
    network: SOLANA_NETWORK.name,
  });
  await markChargeFailed({
    chargeId: params.chargeId,
    fromStatus: "settled",
    errorMessage: `refund_failed: ${params.reason}`,
  });
  return {
    ok: false,
    httpStatus: params.httpStatus,
    message: `${params.reason} The refund could not be sent automatically; support has been notified.`,
    refundTxHash: null,
  };
}

function mapVerificationStatus(
  reason: Exclude<Awaited<ReturnType<typeof verifyUsdcPayment>>, { ok: true }>["reason"],
): number {
  switch (reason) {
    case "invalid_signature":
      return 400;
    case "not_found":
      return 404;
    case "payer_mismatch":
      return 403;
    case "failed_on_chain":
    case "no_usdc_credit":
    case "amount_short":
      return 402;
    case "rpc_error":
      return 503;
  }
}

/** Same-origin path with the target and text as query params (text may be the {text} template). */
function buildActionPath(
  basePath: string,
  target: PostNowBlinkTarget,
  text: string,
): string {
  const query = new URLSearchParams({
    account_id: target.accountId,
    platform: target.platform,
  });
  // The spec's {text} placeholder must survive verbatim for the client to fill.
  const encodedText = text === "{text}" ? text : encodeURIComponent(text);
  return `${basePath}?${query.toString()}&text=${encodedText}`;
}

function formatUsdcLabel(amountUsdc: number): string {
  return `${amountUsdc.toFixed(2)} USDC`;
}
