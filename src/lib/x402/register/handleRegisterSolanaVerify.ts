import "server-only";

import { randomBytes } from "node:crypto";
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
import { verifySolanaSiweAuth } from "@/lib/x402/solana/verifySolanaSiweAuth";
import type { VerifySolanaSiweAuthError } from "@/lib/x402/solana/verifySolanaSiweAuth";
import { consumeSiweNonce } from "@/lib/x402/siwe/consumeSiweNonce";
import { insertRegisterAtomic } from "./insertRegisterAtomic";
import type { RegisterNetworkContext, RegisterSuccessPayload } from "./types";
import type { RegisterVerifyError } from "./handleRegisterVerify";

// ---------------------------------------------------------------------------
// Result types (reuse RegisterVerifyResult shape)
// ---------------------------------------------------------------------------

export type RegisterSolanaVerifyResult =
  | {
      ok: true;
      payload: RegisterSuccessPayload;
      settleResponseHeader: string | null;
    }
  | { ok: false; error: RegisterVerifyError };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_FACILITATOR_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402";

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Full Solana register verify flow. Mirrors handleRegisterVerify but uses:
 * - verifySolanaSiweAuth instead of verifySiweAuth (Ed25519 vs secp256k1)
 * - X402_RECIPIENT_SOLANA env instead of X402_RECIPIENT_EVM
 * - Solana network in facilitator calls
 *
 * Body: { siweMessage: string, siweSignature: string }
 * (siweSignature is base58-encoded Ed25519 for Solana, not hex)
 */
export async function handleRegisterSolanaVerify(
  request: NextRequest,
  paymentHeader: string,
  context: RegisterNetworkContext,
  ipHash: string | null
): Promise<RegisterSolanaVerifyResult> {
  // -- 1. Rate limit
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

  // -- 2. Decode X-PAYMENT header
  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = decodePaymentSignatureHeader(paymentHeader);
  } catch (err) {
    console.error("[handleRegisterSolanaVerify] Failed to decode X-PAYMENT:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "malformed_payment",
        message: "X-PAYMENT header is not valid base64-encoded JSON.",
      },
    };
  }

  // -- 3. Extract payer address (Solana: may be in a different payload location)
  const payerAddress = extractSolanaPayerAddress(paymentPayload);
  if (!payerAddress) {
    return {
      ok: false,
      error: {
        kind: "malformed_payment",
        message: "X-PAYMENT payload missing payer address.",
      },
    };
  }

  // -- 4. Parse request body
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

  if (!siweSignature) {
    return {
      ok: false,
      error: {
        kind: "malformed_body",
        message: "Missing siweSignature in request body.",
      },
    };
  }

  // -- 5. Extract nonce from SIWS message (parse manually)
  let siweNonce: string;
  try {
    const nonceMatch = siweMessage.match(/Nonce: (.+)/);
    if (!nonceMatch || !nonceMatch[1]) {
      return {
        ok: false,
        error: {
          kind: "siwe_parse_failed",
          message: "SIWS message is missing the Nonce field.",
        },
      };
    }
    siweNonce = nonceMatch[1].trim();
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "siwe_parse_failed",
        message: err instanceof Error
          ? err.message
          : "Failed to parse SIWS message for nonce extraction.",
      },
    };
  }

  // -- 6. Verify SIWS message + signature (Ed25519)
  const siweResult = await verifySolanaSiweAuth({
    message: siweMessage,
    signature: siweSignature,
    expectedAddress: payerAddress,
    expectedNonce: siweNonce,
    expectedDomain: context.expectedDomain,
  });

  if (!siweResult.ok) {
    return { ok: false, error: mapSiwsError(siweResult.error) };
  }

  // -- 7. Consume SIWE nonce (shared table with EVM)
  const nonceResult = await consumeSiweNonce(siweNonce);
  if (!nonceResult.ok) {
    if (nonceResult.reason === "db_error") {
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

  // -- 8. Check existing wallet (idempotent retry)
  const existingWallet = await lookupExistingWallet(payerAddress);
  if (existingWallet) {
    console.log(`[handleRegisterSolanaVerify] Wallet already registered: ${existingWallet.id} (${payerAddress})`);
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

  // -- 9. Read pricing
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

  // -- 10. Verify payment
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

  // -- 11. Settle payment
  const settleResult = await settlePayment({
    paymentHeader,
    network: context.network,
  });

  if (!settleResult.ok) {
    return { ok: false, error: mapSettleError(settleResult.error) };
  }

  // -- 12. Build X-PAYMENT-RESPONSE header
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

  // -- 13. Generate principalId
  const principalId = `wallet_${randomBytes(16).toString("hex")}`;

  // -- 14. Atomic DB insert
  const insertResult = await insertRegisterAtomic({
    principalId,
    address: payerAddress,
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
    console.error(`[handleRegisterSolanaVerify] DB insert failed after settle (txHash=${settleResult.txHash}). Initiating refund. Error: ${insertResult.error.message}`);

    let refundTxHash: string | null = null;
    const refundResult = await refundPayment({
      originalTxHash: settleResult.txHash,
      payerAddress: verifyResult.payerAddress,
      amountUsdc: verifyResult.chargeAmountUsdc,
      network: context.network,
      reason: "db_insert_failed_post_settle_solana_register",
    });

    if (refundResult.ok) {
      refundTxHash = refundResult.refundTxHash;
      console.log(`[handleRegisterSolanaVerify] Refund succeeded: ${refundTxHash}`);
    } else {
      console.error(`[handleRegisterSolanaVerify] Refund also failed: ${refundResult.error.message}`);
    }

    return {
      ok: false,
      error: {
        kind: "db_insert_failed_refund_initiated",
        message: insertResult.error.message ?? "DB insert failed after settlement.",
        refundTxHash,
      },
    };
  }

  // -- 15. Success
  return {
    ok: true,
    payload: {
      principalId: insertResult.principalId,
      walletId: insertResult.walletId,
      address: payerAddress,
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

function extractSolanaPayerAddress(
  payload: PaymentPayload
): string | null {
  const inner = payload.payload;
  if (inner && typeof inner === "object") {
    // Try EVM-style authorization.from first
    const auth = (inner as Record<string, unknown>).authorization;
    if (auth && typeof auth === "object") {
      const from = (auth as Record<string, unknown>).from;
      if (typeof from === "string") return from;
    }
    // Solana may store payer differently
    const payer = (inner as Record<string, unknown>).payer;
    if (typeof payer === "string") return payer;
  }
  return null;
}

async function lookupExistingWallet(address: string) {
  const { data, error } = await adminSupabase
    .from("wallets")
    .select("id, address, chain, sanctions_status")
    .eq("address", address)
    .maybeSingle();

  if (error) {
    console.warn(`[handleRegisterSolanaVerify] DB error checking existing wallet: ${error.message}`);
    return null;
  }

  return data;
}

async function readRegisterPrice(): Promise<number | null> {
  const { data, error } = await adminSupabase
    .from("pricing_actions")
    .select("usdc_price")
    .eq("action", "register")
    .maybeSingle();

  if (error || !data) {
    console.error(`[handleRegisterSolanaVerify] Failed to read register price: ${error?.message ?? "no row"}`);
    return null;
  }

  return data.usdc_price;
}

function mapSiwsError(
  error: VerifySolanaSiweAuthError
): RegisterVerifyError {
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
    case "nonce_mismatch":
      return { kind: "siwe_nonce_invalid", reason: "not_found" };
    case "expired":
      return { kind: "siwe_expired", message: error.message };
    case "invalid_signature":
      return { kind: "siwe_invalid_signature", message: error.message };
    case "verification_error":
      return { kind: "siwe_invalid_signature", message: error.message };
  }
}

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
      return { kind: "verify_facilitator_error", message: error.message };
  }
}

function mapSettleError(
  error: SettlePaymentError
): RegisterVerifyError {
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
