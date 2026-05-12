import "server-only";

import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { parseSiweMessage } from "viem/siwe";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import { encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentPayload } from "@x402/core/types";
import type { SettleResponse } from "@x402/core/types";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { adminSupabase } from "@/actions/api/adminSupabase";
import {
  verifyPayment,
  settlePayment,
  refundPayment,
} from "@/lib/x402/facilitator";
import type { VerifyPaymentError } from "@/lib/x402/facilitator";
import type { SettlePaymentError } from "@/lib/x402/facilitator";
import { verifySiweAuth } from "@/lib/x402/siwe/verifySiweAuth";
import type { VerifySiweAuthError } from "@/lib/x402/siwe/verifySiweAuth";
import { consumeSiweNonce } from "@/lib/x402/siwe/consumeSiweNonce";
import { insertRegisterAtomic } from "./insertRegisterAtomic";
import type {
  RegisterNetworkContext,
  RegisterSuccessPayload,
} from "./types";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type RegisterVerifyResult =
  | {
      ok: true;
      payload: RegisterSuccessPayload;
      settleResponseHeader: string | null;
    }
  | { ok: false; error: RegisterVerifyError };

/** Every error variant the verify flow can produce. */
export type RegisterVerifyError =
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "missing_payment_header"; message: string }
  | { kind: "malformed_payment"; message: string }
  | { kind: "missing_body"; message: string }
  | { kind: "malformed_body"; message: string }
  | { kind: "siwe_parse_failed"; message: string }
  | {
      kind: "siwe_domain_mismatch";
      expected: string;
      received: string | undefined;
    }
  | {
      kind: "siwe_address_mismatch";
      expected: string;
      received: string | undefined;
    }
  | {
      kind: "siwe_chain_mismatch";
      expected: number;
      received: number | undefined;
    }
  | {
      kind: "siwe_nonce_invalid";
      reason: "not_found" | "already_used" | "expired";
    }
  | { kind: "siwe_expired"; message: string }
  | { kind: "siwe_not_yet_valid"; message: string }
  | { kind: "siwe_invalid_signature"; message: string }
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
  | {
      kind: "db_insert_failed_refund_initiated";
      message: string;
      refundTxHash: string | null;
    };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_FACILITATOR_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402";

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Full register verify flow. Called when X-PAYMENT header is present.
 *
 * Flow:
 *   1. Rate limit check (x402_register_verify, 5/min per IP)
 *   2. Decode X-PAYMENT header via @x402/core
 *   3. Parse and validate request body (SIWE message + signature)
 *   4. Extract nonce from SIWE message, verify SIWE fields + signature
 *   5. Consume SIWE nonce (atomic single-use marker)
 *   6. Check if wallet already exists (idempotent retry)
 *   7. verifyPayment (facilitator + KYT)
 *   8. settlePayment (on-chain USDC transfer)
 *   9. insertRegisterAtomic (Postgres RPC)
 *  10. If DB insert fails post-settle: refundPayment, return error
 */
export async function handleRegisterVerify(
  request: NextRequest,
  paymentHeader: string,
  context: RegisterNetworkContext,
  ipHash: string | null
): Promise<RegisterVerifyResult> {
  // ── 1. Rate limit ───────────────────────────────────────────────────
  const rateLimitResult = await checkRateLimit(
    "x402_register_verify",
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

  // ── 2. Decode X-PAYMENT header ─────────────────────────────────────
  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = decodePaymentSignatureHeader(paymentHeader);
  } catch (err) {
    console.error("[handleRegisterVerify] Failed to decode X-PAYMENT:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "malformed_payment",
        message: "X-PAYMENT header is not valid base64-encoded JSON.",
      },
    };
  }

  // ── 3. Extract payer address from payment payload ──────────────────
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

  // ── 4. Parse request body ──────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      error: {
        kind: "missing_body",
        message: "Request body must be valid JSON.",
      },
    };
  }

  const siweMessage =
    typeof body.siweMessage === "string" ? body.siweMessage : null;
  const siweSignature =
    typeof body.siweSignature === "string" ? body.siweSignature : null;

  if (!siweMessage) {
    return {
      ok: false,
      error: {
        kind: "malformed_body",
        message: "Missing siweMessage in request body.",
      },
    };
  }

  if (!siweSignature || !siweSignature.startsWith("0x")) {
    return {
      ok: false,
      error: {
        kind: "malformed_body",
        message: "Missing or invalid siweSignature in request body.",
      },
    };
  }

  // ── 5. Extract nonce from SIWE message ─────────────────────────────
  let siweNonce: string;
  try {
    const parsed = parseSiweMessage(siweMessage);
    if (!parsed.nonce) {
      return {
        ok: false,
        error: {
          kind: "siwe_parse_failed",
          message: "SIWE message is missing the nonce field.",
        },
      };
    }
    siweNonce = parsed.nonce;
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "siwe_parse_failed",
        message: err instanceof Error
          ? err.message
          : "Failed to parse SIWE message for nonce extraction.",
      },
    };
  }

  // ── 6. Verify SIWE message + signature ─────────────────────────────
  const siweResult = await verifySiweAuth({
    message: siweMessage,
    signature: siweSignature as `0x${string}`,
    expectedAddress: payerAddress as `0x${string}`,
    network: context.network,
    expectedNonce: siweNonce,
    expectedDomain: context.expectedDomain,
  });

  if (!siweResult.ok) {
    return { ok: false, error: mapSiweError(siweResult.error) };
  }

  // ── 7. Consume SIWE nonce ──────────────────────────────────────────
  const nonceResult = await consumeSiweNonce(siweNonce);
  if (!nonceResult.ok) {
    if (nonceResult.reason === "db_error") {
      // DB error during nonce consumption is a server-side issue.
      // Fail-closed: treat as invalid nonce.
      return {
        ok: false,
        error: { kind: "siwe_nonce_invalid", reason: "not_found" },
      };
    }
    return {
      ok: false,
      error: { kind: "siwe_nonce_invalid", reason: nonceResult.reason },
    };
  }

  // ── 8. Check existing wallet (idempotent retry) ────────────────────
  // If the wallet already exists, return 200 OK without settling.
  // The agent's X-PAYMENT authorization is NOT claimed; it expires or
  // can be reused for the next operation (connect, post). This prevents
  // double-charging on idempotent retries.
  const existingWallet = await lookupExistingWallet(payerAddress);
  if (existingWallet) {
    console.log(`[handleRegisterVerify] Wallet already registered: ${existingWallet.id} (${payerAddress})`);
    return {
      ok: true,
      payload: {
        principalId: existingWallet.id,
        walletId: existingWallet.id,
        address: existingWallet.address,
        chain: existingWallet.chain,
        sanctionsStatus: existingWallet.sanctions_status,
        isNew: false,
        chargeId: null,
      },
      settleResponseHeader: null,
    };
  }

  // ── 9. Read pricing ────────────────────────────────────────────────
  const registerPrice = await readRegisterPrice();
  if (registerPrice === null) {
    return {
      ok: false,
      error: {
        kind: "verify_facilitator_error",
        message: "Unable to read register pricing from database.",
      },
    };
  }

  // ── 10. Verify payment (facilitator + KYT) ─────────────────────────
  const verifyResult = await verifyPayment({
    paymentHeader,
    resourceUrl: context.resourceUrl,
    amountUsdc: registerPrice,
    recipientAddress: context.recipientAddress,
    network: context.network,
  });

  if (!verifyResult.ok) {
    return { ok: false, error: mapVerifyError(verifyResult.error) };
  }

  // ── 11. Settle payment (on-chain USDC transfer) ────────────────────
  const settleResult = await settlePayment({
    paymentHeader,
    network: context.network,
  });

  if (!settleResult.ok) {
    return { ok: false, error: mapSettleError(settleResult.error) };
  }

  // ── 12. Build X-PAYMENT-RESPONSE header ────────────────────────────
  const atomicAmount = String(
    Math.round(registerPrice * 10 ** context.network.usdcDecimals)
  );
  const settleResponse: SettleResponse = {
    success: true,
    payer: verifyResult.payerAddress,
    transaction: settleResult.txHash,
    network: context.network.caipNetwork as `${string}:${string}`,
    amount: atomicAmount,
  };
  const settleResponseHeader = encodePaymentResponseHeader(settleResponse);

  // ── 13. Generate principalId ───────────────────────────────────────
  const principalId = `wallet_${randomBytes(16).toString("hex")}`;

  // ── 14. Atomic DB insert ───────────────────────────────────────────
  const insertResult = await insertRegisterAtomic({
    principalId,
    address: verifyResult.payerAddress.toLowerCase(),
    chain: context.network.name,
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
    sanctionsSource: "cdp_kyt",
  });

  if (!insertResult.ok) {
    // DB insert failed post-settle: MUST refund.
    console.error(`[handleRegisterVerify] DB insert failed after settle (txHash=${settleResult.txHash}). Initiating refund. Error: ${insertResult.error.message}`);

    let refundTxHash: string | null = null;
    const refundResult = await refundPayment({
      originalTxHash: settleResult.txHash,
      payerAddress: verifyResult.payerAddress,
      amountUsdc: verifyResult.chargeAmountUsdc,
      network: context.network,
      reason: "db_insert_failed_post_settle",
    });

    if (refundResult.ok) {
      refundTxHash = refundResult.refundTxHash;
      console.log(`[handleRegisterVerify] Refund succeeded: ${refundTxHash}`);
    } else {
      console.error(`[handleRegisterVerify] Refund also failed: ${refundResult.error.message}`);
    }

    return {
      ok: false,
      error: {
        kind: "db_insert_failed_refund_initiated",
        message:
          insertResult.error.message ??
          "DB insert failed after settlement.",
        refundTxHash,
      },
    };
  }

  // ── 15. Success ────────────────────────────────────────────────────
  return {
    ok: true,
    payload: {
      principalId: insertResult.principalId,
      walletId: insertResult.walletId,
      address: verifyResult.payerAddress.toLowerCase(),
      chain: context.network.name,
      sanctionsStatus: "clean",
      isNew: true,
      chargeId: insertResult.chargeId,
    },
    settleResponseHeader,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extracts the payer address from an EVM exact-scheme payment payload. */
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

/** Look up an existing wallet by address (case-insensitive). */
async function lookupExistingWallet(address: string) {
  const { data, error } = await adminSupabase
    .from("wallets")
    .select("id, address, chain, sanctions_status")
    .ilike("address", address.toLowerCase())
    .maybeSingle();

  if (error) {
    console.warn(`[handleRegisterVerify] DB error checking existing wallet: ${error.message}`);
    return null;
  }

  return data;
}

/** Read the register action's USDC price from pricing_actions. */
async function readRegisterPrice(): Promise<number | null> {
  const { data, error } = await adminSupabase
    .from("pricing_actions")
    .select("usdc_price")
    .eq("action", "register")
    .maybeSingle();

  if (error || !data) {
    console.error(`[handleRegisterVerify] Failed to read register price: ${error?.message ?? "no row"}`);
    return null;
  }

  return data.usdc_price;
}

/** Maps a verifySiweAuth error to a RegisterVerifyError. */
function mapSiweError(error: VerifySiweAuthError): RegisterVerifyError {
  switch (error.kind) {
    case "parse_failed":
      return { kind: "siwe_parse_failed", message: error.message };
    case "domain_mismatch":
      return {
        kind: "siwe_domain_mismatch",
        expected: error.expected,
        received: error.received,
      };
    case "address_mismatch":
      return {
        kind: "siwe_address_mismatch",
        expected: error.expected,
        received: error.received,
      };
    case "chain_mismatch":
      return {
        kind: "siwe_chain_mismatch",
        expected: error.expected,
        received: error.received,
      };
    case "nonce_mismatch":
      return { kind: "siwe_nonce_invalid", reason: "not_found" };
    case "expired":
      return { kind: "siwe_expired", message: error.message };
    case "not_yet_valid":
      return { kind: "siwe_not_yet_valid", message: error.message };
    case "invalid_signature":
      return { kind: "siwe_invalid_signature", message: error.message };
    case "verification_error":
      return { kind: "siwe_invalid_signature", message: error.message };
  }
}

/** Maps a verifyPayment error to a RegisterVerifyError. */
function mapVerifyError(error: VerifyPaymentError): RegisterVerifyError {
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
      return {
        kind: "verify_facilitator_error",
        message: error.message,
      };
  }
}

/** Maps a settlePayment error to a RegisterVerifyError. */
function mapSettleError(error: SettlePaymentError): RegisterVerifyError {
  switch (error.kind) {
    case "not_verified":
      return { kind: "settle_not_verified", message: error.message };
    case "insufficient_funds":
      return {
        kind: "settle_insufficient_funds",
        message: error.message,
      };
    case "facilitator_error":
      return {
        kind: "settle_facilitator_error",
        message: error.message,
      };
    case "timeout":
      return { kind: "settle_timeout", message: error.message };
  }
}
