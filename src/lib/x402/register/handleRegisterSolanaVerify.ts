import "server-only";

import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  decodePaymentSignatureHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { SettleResponse } from "@x402/core/types";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { adminSupabase } from "@/actions/api/adminSupabase";
import type { WalletChain, SanctionsStatus } from "@/lib/types/database.types";
import {
  verifyPayment,
  settlePayment,
  refundPayment,
} from "@/lib/x402/facilitator";
import { FACILITATOR_NAME } from "@/lib/x402/config";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";
import { readActionPrice } from "@/lib/x402/pricing/readActionPrice";
import {
  mapVerifyPaymentError,
  mapSettlePaymentError,
} from "@/lib/x402/payment/errorMaps";
import { extractPayerAddress } from "@/lib/x402/payment/paymentPayload";
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
// Implementation
// ---------------------------------------------------------------------------

/**
 * Full Solana register verify flow. Mirrors handleRegisterVerify but uses:
 * - verifySolanaSiweAuth instead of verifySiweAuth (Ed25519 vs secp256k1)
 * - Base58 addresses, which are case-sensitive: lookups use exact equality
 *   and the stored address keeps its original casing
 *
 * Body: { siweMessage: string, siweSignature: string }
 * (siweSignature is base58-encoded Ed25519 for Solana, not hex)
 *
 * Residual risk (accepted at the June 2026 checkpoint, Phase 4.4 item): the
 * atomic RPC inserts everything after settle, so a process crash between
 * settle and insert leaves a settled payment with no DB row.
 */
export async function handleRegisterSolanaVerify(
  request: NextRequest,
  paymentHeader: string,
  context: RegisterNetworkContext
): Promise<RegisterSolanaVerifyResult> {
  // -- 1. Rate limit (shared scope with the EVM register path)
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

  // -- 2. Extract payer address from the payment payload (unverified claim;
  //       the SIWS signature check below binds it to the holder of the key)
  let payerAddress: string | null = null;
  try {
    payerAddress = extractPayerAddress(
      decodePaymentSignatureHeader(paymentHeader)
    );
  } catch (err) {
    console.error("[handleRegisterSolanaVerify] Failed to decode payment header:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "malformed_payment",
        message: "Payment header is not valid base64-encoded JSON.",
      },
    };
  }

  if (!payerAddress) {
    return {
      ok: false,
      error: {
        kind: "malformed_payment",
        message: "Payment payload is missing the payer address.",
      },
    };
  }

  // -- 3. Parse request body
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

  // -- 4. Verify SIWS message + signature (Ed25519)
  const siweResult = await verifySolanaSiweAuth({
    message: siweMessage,
    signature: siweSignature,
    expectedAddress: payerAddress,
    expectedDomain: context.expectedDomain,
    expectedUri: context.resourceUrl,
  });

  if (!siweResult.ok) {
    return { ok: false, error: mapSiwsError(siweResult.error) };
  }

  // -- 5. Consume the SIWS nonce (shared siwe_nonces table with EVM).
  //       This proves the nonce was server-issued, unused, and unexpired.
  const nonceResult = await consumeSiweNonce(
    siweResult.parsedMessage.nonce,
    payerAddress
  );
  if (!nonceResult.ok) {
    if (nonceResult.reason === "db_error") {
      // Fail-closed: treat a consumption DB error as an invalid nonce.
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

  // -- 6. Check existing wallet (idempotent retry; no charge). Fail closed
  //       on a lookup error: charging a wallet that may already be
  //       registered forces a charge-then-refund round trip.
  const existingLookup = await lookupExistingWallet(payerAddress);
  if (!existingLookup.ok) {
    return {
      ok: false,
      error: {
        kind: "db_error",
        message: "Failed to check existing wallet registration.",
      },
    };
  }
  const existingWallet = existingLookup.wallet;
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

  // -- 7. Read pricing
  const priceResult = await readActionPrice("register");
  if (!priceResult.ok) {
    return {
      ok: false,
      error: {
        kind: "verify_facilitator_error",
        message: "Unable to read register pricing from database.",
      },
    };
  }
  const registerPrice = priceResult.usdcPrice;

  // -- 8. Verify payment
  const verifyResult = await verifyPayment({
    paymentHeader,
    resourceUrl: context.resourceUrl,
    amountUsdc: registerPrice,
    recipientAddress: context.recipientAddress,
    network: context.network,
  });

  if (!verifyResult.ok) {
    return { ok: false, error: mapVerifyPaymentError(verifyResult.error) };
  }

  // -- 9. Settle payment
  const settleResult = await settlePayment({
    paymentHeader,
    network: context.network,
  });

  if (!settleResult.ok) {
    return { ok: false, error: mapSettlePaymentError(settleResult.error) };
  }

  // -- 10. Build the settlement response header
  const settleResponse: SettleResponse = {
    success: true,
    payer: verifyResult.payerAddress,
    transaction: settleResult.txHash,
    network: context.network.caipNetwork as `${string}:${string}`,
    amount: usdcToAtomic(registerPrice, context.network.usdcDecimals),
  };
  const settleResponseHeader = encodePaymentResponseHeader(settleResponse);

  // -- 11. Generate principalId
  const principalId = `wallet_${randomBytes(16).toString("hex")}`;

  // -- 12. Atomic DB insert. Base58 addresses keep their original casing
  //        (case-sensitive); network/asset/facilitator store DB short names.
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
    chargeNetwork: context.network.name,
    chargeAsset: "USDC",
    chargePayerAddress: verifyResult.payerAddress,
    chargeRecipientAddress: context.recipientAddress,
    chargeFacilitator: FACILITATOR_NAME,
    chargeSettledAt: settleResult.settledAt,
    sanctionsSource: "cdp_kyt",
  });

  if (!insertResult.ok) {
    console.error(`[handleRegisterSolanaVerify] DB insert failed after settle (txHash=${settleResult.txHash}). Initiating refund. Error: ${insertResult.error.message}`);

    const refundResult = await refundPayment({
      originalTxHash: settleResult.txHash,
      payerAddress: verifyResult.payerAddress,
      amountUsdc: verifyResult.chargeAmountUsdc,
      network: context.network,
      reason: "db_insert_failed_post_settle_solana_register",
    });

    if (refundResult.ok) {
      console.log(`[handleRegisterSolanaVerify] Refund succeeded: ${refundResult.refundTxHash}`);
    } else {
      // Settled money with no charge row and no refund: the tx hash in this
      // log line is the only reconciliation trail. Phase 4.4 owns tooling.
      console.error(`[handleRegisterSolanaVerify] REFUND FAILED after settle (txHash=${settleResult.txHash}): ${refundResult.error.message}`);
    }

    return {
      ok: false,
      error: {
        kind: "db_insert_failed",
        message: insertResult.error.message ?? "DB insert failed after settlement.",
        refundInitiated: refundResult.ok,
        refundTxHash: refundResult.ok ? refundResult.refundTxHash : null,
      },
    };
  }

  // -- 13. Success
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

/**
 * Look up an existing wallet by exact address. Base58 is case-sensitive, so
 * no case folding here (unlike the EVM path, which stores lowercase). A
 * read error is reported, not swallowed, so the caller can refuse to charge
 * a possibly-registered wallet.
 */
async function lookupExistingWallet(address: string): Promise<
  | {
      ok: true;
      wallet: {
        id: string;
        address: string;
        chain: WalletChain;
        sanctions_status: SanctionsStatus;
      } | null;
    }
  | { ok: false }
> {
  const { data: wallet, error } = await adminSupabase
    .from("wallets")
    .select("id, address, chain, sanctions_status")
    .eq("address", address)
    .maybeSingle();

  if (error) {
    console.error(`[handleRegisterSolanaVerify] DB error checking existing wallet: ${error.message}`);
    return { ok: false };
  }

  return { ok: true, wallet };
}

/** Maps a verifySolanaSiweAuth error to a RegisterVerifyError. */
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
    case "uri_mismatch":
      return {
        kind: "siwe_uri_mismatch",
        expected: error.expected,
        received: error.received,
      };
    case "expired":
      return { kind: "siwe_expired", message: error.message };
    case "invalid_signature":
      return { kind: "siwe_invalid_signature", message: error.message };
    case "verification_error":
      return { kind: "siwe_invalid_signature", message: error.message };
  }
}
