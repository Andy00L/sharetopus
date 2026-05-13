import "server-only";

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import { encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentPayload, SettleResponse } from "@x402/core/types";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { adminSupabase } from "@/actions/api/adminSupabase";
import {
  verifyPayment,
  settlePayment,
  refundPayment,
} from "@/lib/x402/facilitator";
import type { VerifyPaymentError, SettlePaymentError } from "@/lib/x402/facilitator";
import { resolveWalletPrincipal } from "@/lib/x402/auth/resolveWalletPrincipal";
import { issueConnectionToken } from "@/lib/x402/oauth/connectionToken";
import { generateOAuthState } from "@/lib/x402/oauth/state";
import { buildOAuthUrl } from "./buildOAuthUrl";
import { insertConnectAtomic } from "./insertConnectAtomic";
import type {
  ConnectNetworkContext,
  ConnectSuccessPayload,
  Platform,
} from "./types";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ConnectVerifyResult =
  | {
      ok: true;
      payload: ConnectSuccessPayload;
      settleResponseHeader: string | null;
    }
  | { ok: false; error: ConnectVerifyError };

export type ConnectVerifyError =
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "missing_payment_header"; message: string }
  | { kind: "malformed_payment"; message: string }
  | { kind: "missing_body"; message: string }
  | { kind: "malformed_body"; message: string }
  | { kind: "unsupported_platform"; message: string }
  | { kind: "wallet_not_registered"; message: string }
  | { kind: "verify_amount_mismatch"; message: string }
  | { kind: "verify_network_mismatch"; message: string }
  | { kind: "verify_recipient_mismatch"; message: string }
  | { kind: "verify_replay_detected"; message: string }
  | { kind: "verify_invalid_signature"; message: string }
  | { kind: "verify_kyt_sanctioned"; message: string }
  | { kind: "verify_facilitator_error"; message: string }
  | { kind: "settle_insufficient_funds"; message: string }
  | { kind: "settle_facilitator_error"; message: string }
  | { kind: "settle_timeout"; message: string }
  | { kind: "settle_not_verified"; message: string }
  | { kind: "oauth_url_build_failed"; message: string }
  | {
      kind: "db_insert_failed_refund_initiated";
      message: string;
      refundTxHash: string | null;
    };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OAUTH_EXPIRY_MINUTES = 15;
const GRACE_PERIOD_MS = 60 * 60 * 1000; // 1 hour grace for HMAC token
const DEFAULT_FACILITATOR_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402";

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Full /connect verify flow. Called when X-PAYMENT header is present.
 *
 * Flow:
 *   1. Rate limit check (x402_connect_verify, 5/min per IP)
 *   2. Decode X-PAYMENT header
 *   3. Extract payer address, resolve wallet principal
 *   4. Reconnect check (idempotent no-charge if healthy connection exists)
 *   5. Read connect pricing
 *   6. verifyPayment (facilitator + KYT)
 *   7. settlePayment (on-chain USDC transfer)
 *   8. Generate connectionId, oauth_state, expiresAt, build OAuth URL
 *   9. insertConnectAtomic (Postgres RPC)
 *  10. issueConnectionToken (HMAC)
 *  11. If DB fails post-settle: refundPayment, return error with refundTxHash
 */
export async function handleConnectVerify(
  request: NextRequest,
  paymentHeader: string,
  context: ConnectNetworkContext,
  ipHash: string | null
): Promise<ConnectVerifyResult> {
  // -- 1. Rate limit
  const rateLimitResult = await checkRateLimit(
    "x402_connect_verify",
    null,
    5,
    60
  );
  if (!rateLimitResult.success) {
    return {
      ok: false,
      error: {
        kind: "rate_limited",
        retryAfterSeconds: rateLimitResult.resetIn ?? 60,
      },
    };
  }

  // -- 2. Decode X-PAYMENT header
  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = decodePaymentSignatureHeader(paymentHeader);
  } catch (err) {
    console.error("[handleConnectVerify] Failed to decode X-PAYMENT:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "malformed_payment",
        message: "X-PAYMENT header is not valid base64-encoded JSON.",
      },
    };
  }

  // -- 3. Extract payer address and resolve wallet
  const payerAddress = extractPayerAddress(paymentPayload);
  if (!payerAddress) {
    return {
      ok: false,
      error: {
        kind: "malformed_payment",
        message:
          "X-PAYMENT payload missing authorization.from (payer address).",
      },
    };
  }

  const walletResult = await resolveWalletPrincipal(payerAddress);
  if (!walletResult.ok) {
    return {
      ok: false,
      error: {
        kind: "wallet_not_registered",
        message: walletResult.message,
      },
    };
  }
  const wallet = walletResult.principal;

  // -- 4. Reconnect check: healthy connection = no charge
  const { data: existing } = await adminSupabase
    .from("social_accounts")
    .select("id, account_identifier, token_expires_at, connection_id")
    .eq("principal_id", wallet.principalId)
    .eq("platform", context.platform)
    .is("deleted_at", null)
    .gt("token_expires_at", new Date().toISOString())
    .maybeSingle();

  if (existing) {
    console.log(`[handleConnectVerify] Wallet ${wallet.principalId} already has healthy ${context.platform} connection. Returning idempotent.`);

    const existingConnectionId = existing.connection_id ?? existing.id;
    const tokenResult = issueConnectionToken({
      connectionId: existingConnectionId,
      walletAddress: wallet.address,
      chargeId: "",
      iat: Date.now(),
      exp: new Date(existing.token_expires_at!).getTime() + GRACE_PERIOD_MS,
      platform: context.platform,
    });

    return {
      ok: true,
      payload: {
        connectionId: existingConnectionId,
        platform: context.platform,
        oauthUrl: "",
        connectionToken: tokenResult.ok ? tokenResult.token : "",
        expiresAt: existing.token_expires_at!,
        isReconnect: true,
      },
      settleResponseHeader: null,
    };
  }

  // -- 5. Read connect pricing
  const connectPrice = await readConnectPrice();
  if (connectPrice === null) {
    return {
      ok: false,
      error: {
        kind: "verify_facilitator_error",
        message: "Unable to read connect pricing from database.",
      },
    };
  }

  // -- 6. Verify payment (facilitator + KYT)
  const verifyResult = await verifyPayment({
    paymentHeader,
    resourceUrl: context.resourceUrl,
    amountUsdc: connectPrice,
    recipientAddress: context.recipientAddress,
    network: context.network,
  });

  if (!verifyResult.ok) {
    return { ok: false, error: mapVerifyError(verifyResult.error) };
  }

  // -- 7. Settle payment
  const settleResult = await settlePayment({
    paymentHeader,
    network: context.network,
  });

  if (!settleResult.ok) {
    return { ok: false, error: mapSettleError(settleResult.error) };
  }

  // -- 8. Generate connection details + build OAuth URL
  const connectionId = randomUUID();
  const oauthState = generateOAuthState();
  const expiresAt = new Date(
    Date.now() + OAUTH_EXPIRY_MINUTES * 60 * 1000
  ).toISOString();

  const redirectUri = getRedirectUri(context.platform);
  if (!redirectUri) {
    return {
      ok: false,
      error: {
        kind: "oauth_url_build_failed",
        message: `X402_${context.platform.toUpperCase()}_REDIRECT_URI env var not set.`,
      },
    };
  }

  const oauthResult = buildOAuthUrl({
    platform: context.platform,
    state: oauthState,
    redirectUri,
  });

  if (!oauthResult.ok) {
    return {
      ok: false,
      error: {
        kind: "oauth_url_build_failed",
        message: oauthResult.message,
      },
    };
  }

  // -- 9. Build X-PAYMENT-RESPONSE header
  const atomicAmount = String(
    Math.round(connectPrice * 10 ** context.network.usdcDecimals)
  );
  const settleResponse: SettleResponse = {
    success: true,
    payer: verifyResult.payerAddress,
    transaction: settleResult.txHash,
    network: context.network.caipNetwork as `${string}:${string}`,
    amount: atomicAmount,
  };
  const settleResponseHeader = encodePaymentResponseHeader(settleResponse);

  // -- 10. Atomic DB insert
  const insertResult = await insertConnectAtomic({
    principalId: wallet.principalId,
    walletId: wallet.walletId,
    platform: context.platform,
    connectionId,
    oauthState,
    redirectUri,
    expiresAt,
    chargeNonce: verifyResult.nonce,
    chargeRequestId: null,
    chargeTxHash: settleResult.txHash,
    chargeBlockNumber: settleResult.blockNumber,
    chargeAmountUsdc: verifyResult.chargeAmountUsdc,
    chargeFacilitatorFeeUsdc: settleResult.facilitatorFeeUsdc,
    chargeNetwork: context.network.caipNetwork,
    chargeAsset: context.network.usdcAddress,
    chargePayerAddress: verifyResult.payerAddress,
    chargeRecipientAddress: context.recipientAddress,
    chargeFacilitator:
      process.env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR_URL,
    chargeSettledAt: settleResult.settledAt,
  });

  if (!insertResult.ok) {
    // DB insert failed post-settle: MUST refund.
    console.error(`[handleConnectVerify] DB insert failed after settle (txHash=${settleResult.txHash}). Initiating refund. Error: ${insertResult.error.message}`);

    let refundTxHash: string | null = null;
    const refundResult = await refundPayment({
      originalTxHash: settleResult.txHash,
      payerAddress: verifyResult.payerAddress,
      amountUsdc: verifyResult.chargeAmountUsdc,
      network: context.network,
      reason: "db_insert_failed_post_settle_connect",
    });

    if (refundResult.ok) {
      refundTxHash = refundResult.refundTxHash;
      console.log(`[handleConnectVerify] Refund succeeded: ${refundTxHash}`);
    } else {
      console.error(`[handleConnectVerify] Refund also failed: ${refundResult.error.message}`);
    }

    return {
      ok: false,
      error: {
        kind: "db_insert_failed_refund_initiated",
        message:
          insertResult.error.message ?? "DB insert failed after settlement.",
        refundTxHash,
      },
    };
  }

  // -- 11. Issue HMAC connection token
  const tokenResult = issueConnectionToken({
    connectionId,
    walletAddress: wallet.address,
    chargeId: insertResult.chargeId,
    iat: Date.now(),
    exp: new Date(expiresAt).getTime() + GRACE_PERIOD_MS,
    platform: context.platform,
  });

  return {
    ok: true,
    payload: {
      connectionId,
      platform: context.platform,
      oauthUrl: oauthResult.url,
      connectionToken: tokenResult.ok ? tokenResult.token : "",
      expiresAt,
      isReconnect: false,
    },
    settleResponseHeader,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractPayerAddress(payload: PaymentPayload): string | null {
  const inner = payload.payload;
  if (inner && typeof inner === "object") {
    const auth = (inner as Record<string, unknown>).authorization;
    if (auth && typeof auth === "object") {
      const from = (auth as Record<string, unknown>).from;
      if (typeof from === "string") return from;
    }
  }
  return null;
}

async function readConnectPrice(): Promise<number | null> {
  const { data, error } = await adminSupabase
    .from("pricing_actions")
    .select("usdc_price")
    .eq("action", "connect_account")
    .maybeSingle();

  if (error || !data) {
    console.error(`[handleConnectVerify] Failed to read connect price: ${error?.message ?? "no row"}`);
    return null;
  }

  return data.usdc_price;
}

function getRedirectUri(platform: Platform): string | null {
  switch (platform) {
    case "linkedin":
      return process.env.X402_LINKEDIN_REDIRECT_URI ?? null;
    case "tiktok":
      return process.env.X402_TIKTOK_REDIRECT_URI ?? null;
    case "pinterest":
      return process.env.X402_PINTEREST_REDIRECT_URI ?? null;
    case "instagram":
      return process.env.X402_INSTAGRAM_REDIRECT_URI ?? null;
  }
}

function mapVerifyError(error: VerifyPaymentError): ConnectVerifyError {
  switch (error.kind) {
    case "malformed_header":
      return { kind: "malformed_payment", message: error.message };
    case "invalid_signature":
      return { kind: "verify_invalid_signature", message: error.message };
    case "amount_mismatch":
      return {
        kind: "verify_amount_mismatch",
        message: `Expected ${error.expected} USDC, received ${error.received} USDC.`,
      };
    case "network_mismatch":
      return {
        kind: "verify_network_mismatch",
        message: `Expected network ${error.expected}, received ${error.received}.`,
      };
    case "recipient_mismatch":
      return {
        kind: "verify_recipient_mismatch",
        message: `Expected recipient ${error.expected}, received ${error.received}.`,
      };
    case "replay_detected":
      return {
        kind: "verify_replay_detected",
        message: `Payment nonce ${error.nonce} has already been used.`,
      };
    case "kyt_sanctioned":
      return {
        kind: "verify_kyt_sanctioned",
        message: `Payer ${error.payerAddress} is flagged by sanctions screening.`,
      };
    case "facilitator_error":
      return { kind: "verify_facilitator_error", message: error.message };
  }
}

function mapSettleError(error: SettlePaymentError): ConnectVerifyError {
  switch (error.kind) {
    case "not_verified":
      return { kind: "settle_not_verified", message: error.message };
    case "insufficient_funds":
      return { kind: "settle_insufficient_funds", message: error.message };
    case "facilitator_error":
      return { kind: "settle_facilitator_error", message: error.message };
    case "timeout":
      return { kind: "settle_timeout", message: error.message };
  }
}
