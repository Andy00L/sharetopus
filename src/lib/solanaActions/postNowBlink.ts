import "server-only";

import { randomUUID } from "node:crypto";
import { isAddress } from "@solana/kit";
import { and, eq, isNull } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import { directPostBatch } from "@/actions/server/directPostActions/directPostBatch";
import type { DirectPostData } from "@/actions/server/directPostActions/directPostBatch";
import { resolvePlatformTextLimit } from "@/components/core/create/constants/captionLimits";
import { PLATFORM_LABELS, platformSupportsMediaType } from "@/lib/platforms/capabilities";
import { resolveExistingWalletPrincipal } from "@/lib/x402/auth/resolveOrOnboardWalletPrincipal";
import type { WalletPrincipal } from "@/lib/x402/auth/types";
import { refundCharge, updateChargeRecord } from "@/lib/x402/charges/chargeLifecycle";
import { markChargeSettled } from "@/lib/x402/charges/chargeTransitions";
import { insertPendingX402Charge } from "@/lib/x402/charges/insertPendingX402Charge";
import {
  recordUnchargedPayment,
  recordX402Reconciliation,
} from "@/lib/x402/charges/recordReconciliation";
import { getBaseUrl, getRecipientAddress, isX402Platform } from "@/lib/x402/config";
import type { AdapterPlatform } from "@/lib/platforms/capabilities";
import { POST_ACTION_PREFIX } from "@/lib/x402/middleware/resolvePostAction";
import { NETWORKS } from "@/lib/x402/networks";
import { readActionPrice, readFreshActionPrice } from "@/lib/x402/pricing/readActionPrice";
import { buildKnownExplorerTxUrl } from "@/lib/x402/proof/explorer";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";
import { buildUsdcPaymentTransaction } from "./buildUsdcPaymentTransaction";
import { verifyUsdcPayment, type VerifyUsdcPaymentResult } from "./verifyUsdcPayment";

const BLINK_ACTION = `${POST_ACTION_PREFIX}text`;

const DIRECT_SOLANA_FACILITATOR = "solana_direct";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SOLANA_NETWORK = NETWORKS.solana;

export interface PostNowBlinkTarget {
  accountId: string;
  platform: AdapterPlatform;
}

export type BlinkFailure = {
  ok: false;
  httpStatus: number;
  message: string;
  refundTxHash?: string | null;
};

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
  return { ok: true, text };
}

export function checkBlinkTextFitsPlatform(
  platform: AdapterPlatform,
  text: string,
): { ok: true } | BlinkFailure {
  const platformRefusal = checkPlatformTakesTextPosts(platform);
  if (!platformRefusal.ok) return platformRefusal;
  const textLimit = resolvePlatformTextLimit(platform);
  if (text.length > textLimit) {
    return {
      ok: false,
      httpStatus: 400,
      message: `text is ${text.length} characters; ${PLATFORM_LABELS[platform]} allows ${textLimit}.`,
    };
  }
  return { ok: true };
}

function checkPlatformTakesTextPosts(platform: AdapterPlatform): { ok: true } | BlinkFailure {
  if (platformSupportsMediaType(platform, "text")) return { ok: true };
  return {
    ok: false,
    httpStatus: 400,
    message: `${PLATFORM_LABELS[platform]} does not accept text-only posts, so this Blink cannot post there.`,
  };
}

export async function describePostNowAction(
  target: PostNowBlinkTarget,
): Promise<PostNowActionCard> {
  const iconUrl = `${getBaseUrl()}/logo.png`;
  const title = `Post to ${target.platform} with Sharetopus`;

  const platformRefusal = checkPlatformTakesTextPosts(target.platform);
  if (!platformRefusal.ok) {
    return {
      type: "action",
      icon: iconUrl,
      title,
      description: platformRefusal.message,
      label: "Unavailable",
      disabled: true,
      error: { message: platformRefusal.message },
    };
  }

  const priceResult = await readActionPrice(BLINK_ACTION);
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
              max: resolvePlatformTextLimit(target.platform),
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

  const textCheck = checkBlinkTextFitsPlatform(params.target.platform, params.text);
  if (!textCheck.ok) return textCheck;

  const walletResult = await resolveWalletForBlink(params.payerAddressRaw);
  if (!walletResult.ok) return walletResult;

  const ownership = await checkAccountOwnership(walletResult.principal, params.target);
  if (!ownership.ok) return ownership;

  const priceResult = await readFreshActionPrice(BLINK_ACTION);
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
    if (transactionResult.reason === "invalid_amount") {
      console.error(`[preparePostNowPayment] Refusing to charge: ${transactionResult.message}`);
      return { ok: false, httpStatus: 500, message: "Pricing for this action is misconfigured." };
    }
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

  const priceResult = await readFreshActionPrice(BLINK_ACTION);
  if (!priceResult.ok) {
    return { ok: false, httpStatus: 503, message: "Pricing is unavailable right now." };
  }
  const recipientAddress = getRecipientAddress(SOLANA_NETWORK);
  if (!recipientAddress) {
    console.error("[confirmPostNowPayment] X402_RECIPIENT_SOLANA is not set.");
    return { ok: false, httpStatus: 500, message: "Solana payments are not configured." };
  }
  const minimumAtomicAmount = usdcToAtomic(priceResult.usdcPrice, SOLANA_NETWORK.usdcDecimals);
  if (!minimumAtomicAmount.ok) {
    console.error(`[confirmPostNowPayment] Refusing to confirm: ${minimumAtomicAmount.message}`);
    return { ok: false, httpStatus: 503, message: "Pricing is unavailable right now." };
  }

  const verification = await verifyUsdcPayment({
    txSignatureRaw: params.txSignatureRaw,
    expectedPayerAddress: params.payerAddressRaw,
    recipientAddress,
    usdcMint: SOLANA_NETWORK.usdcAddress,
    minimumAtomicAmount: minimumAtomicAmount.atomicAmount,
    network: SOLANA_NETWORK,
  });
  if (!verification.ok) {
    if (verification.reason === "amount_short" && verification.atomicReceived > BigInt(0)) {
      return recordUnderpayment(verification);
    }
    return {
      ok: false,
      httpStatus: mapVerificationStatus(verification.reason),
      message: verification.message,
    };
  }

  const walletResult = await resolveWalletForBlink(verification.payerAddress);
  if (!walletResult.ok) {
    await recordUnchargedPayment({
      txHash: verification.txSignature,
      payerAddress: verification.payerAddress,
      amountAtomic: verification.atomicReceived.toString(),
      network: SOLANA_NETWORK.name,
    });
    return walletResult;
  }
  const principal = walletResult.principal;

  const requestId = randomUUID();
  const chargeInsert = await insertPendingX402Charge({
    principalId: principal.principalId,
    action: BLINK_ACTION,
    amountUsdc: priceResult.usdcPrice,
    amountUsdAtReceipt: null,
    network: SOLANA_NETWORK,
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

  const settledTransition = await markChargeSettled({
    chargeId,
    txHash: verification.txSignature,
    blockNumber: Number(verification.slot),
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

  const textCheck = checkBlinkTextFitsPlatform(params.target.platform, params.text);
  if (!textCheck.ok) {
    return refundAndFail({
      chargeId,
      txSignature: verification.txSignature,
      payerAddress: verification.payerAddress,
      amountUsdc: priceResult.usdcPrice,
      principalId: principal.principalId,
      httpStatus: textCheck.httpStatus,
      reason: textCheck.message,
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

  const recordWrite = await updateChargeRecord(chargeId, { metadata: { batch_id: batchResult.batchId } });
  if (!recordWrite.ok) {
    console.error(
      `[confirmPostNowPayment] CHARGE RECORD INCOMPLETE: charge ${chargeId} dispatched batch ${batchResult.batchId} but the batch link was not saved after a retry (${recordWrite.message}); /proof shows no post for it.`,
    );
  }

  return {
    ok: true,
    txSignature: verification.txSignature,
    explorerUrl: buildKnownExplorerTxUrl("solana", verification.txSignature),
    batchId: batchResult.batchId,
  };
}

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

async function checkAccountOwnership(
  principal: WalletPrincipal,
  target: PostNowBlinkTarget,
): Promise<{ ok: true } | BlinkFailure> {
  const { data: accountRows, error } = await runQuery(
    db
      .select({ id: social_accounts.id })
      .from(social_accounts)
      .where(
        and(
          eq(social_accounts.id, target.accountId),
          eq(social_accounts.principal_id, principal.principalId),
          eq(social_accounts.platform, target.platform),
          isNull(social_accounts.deleted_at),
        ),
      )
      .limit(1),
  );
  if (error) {
    console.error(`[checkAccountOwnership] social_accounts read failed: ${error.message}`);
    return { ok: false, httpStatus: 500, message: "Could not verify the account." };
  }
  if (!accountRows[0]) {
    return {
      ok: false,
      httpStatus: 404,
      message: `No connected ${target.platform} account with that id belongs to this wallet.`,
    };
  }
  return { ok: true };
}

async function refundAndFail(params: {
  chargeId: string;
  txSignature: string;
  payerAddress: string;
  amountUsdc: number;
  principalId: string;
  httpStatus: number;
  reason: string;
}): Promise<BlinkFailure> {
  const refundOutcome = await refundCharge({
    chargeId: params.chargeId,
    settleTxHash: params.txSignature,
    payerAddress: params.payerAddress,
    amountUsdc: params.amountUsdc,
    network: SOLANA_NETWORK,
    reason: params.reason,
    principalId: params.principalId,
  });

  return {
    ok: false,
    httpStatus: params.httpStatus,
    message: refundOutcome.refundInitiated
      ? `${params.reason} Your payment is being refunded.`
      : `${params.reason} The refund could not be sent automatically; it is queued for manual review.`,
    refundTxHash: refundOutcome.refundTxHash,
  };
}

async function recordUnderpayment(
  underpayment: Extract<VerifyUsdcPaymentResult, { reason: "amount_short" }>,
): Promise<BlinkFailure> {
  console.error(
    `[recordUnderpayment] CHARGE RECONCILIATION NEEDED: tx ${underpayment.txSignature} from ${underpayment.payerAddress} paid ${underpayment.atomicReceived} atomic USDC, under the current post-now price; no charge recorded, refund by hand.`,
  );
  await recordUnchargedPayment({
    txHash: underpayment.txSignature,
    payerAddress: underpayment.payerAddress,
    amountAtomic: underpayment.atomicReceived.toString(),
    network: SOLANA_NETWORK.name,
  });
  return {
    ok: false,
    httpStatus: 402,
    message: `${underpayment.message} Nothing was posted. The payment is recorded for a manual refund; do not resend it.`,
  };
}

function mapVerificationStatus(
  reason: Exclude<VerifyUsdcPaymentResult, { ok: true }>["reason"],
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

function buildActionPath(
  basePath: string,
  target: PostNowBlinkTarget,
  text: string,
): string {
  const query = new URLSearchParams({
    account_id: target.accountId,
    platform: target.platform,
  });
  // Solana Actions fill {name} placeholders in a linked action href, so the template stays unencoded (actions-spec v2.4.2).
  const encodedText = text === "{text}" ? text : encodeURIComponent(text);
  return `${basePath}?${query.toString()}&text=${encodedText}`;
}

function formatUsdcLabel(amountUsdc: number): string {
  return `${amountUsdc.toFixed(2)} USDC`;
}
