import "server-only";

import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { parseSiweMessage } from "viem/siwe";
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
import type {
  MappedVerifyError,
  MappedSettleError,
} from "@/lib/x402/payment/errorMaps";
import { extractPayerAddress } from "@/lib/x402/payment/paymentPayload";
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

/**
 * Every error variant the register verify flows (EVM and Solana) can
 * produce. The verify and settle members come from the shared facilitator
 * error mapping in payment/errorMaps.ts.
 */
export type RegisterVerifyError =
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "missing_body"; message: string }
  | { kind: "malformed_body"; message: string }
  | { kind: "db_error"; message: string }
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
      kind: "siwe_uri_mismatch";
      expected: string;
      received: string | undefined;
    }
  | {
      kind: "siwe_nonce_invalid";
      reason: "not_found" | "already_used" | "expired";
    }
  | { kind: "siwe_expired"; message: string }
  | { kind: "siwe_not_yet_valid"; message: string }
  | { kind: "siwe_invalid_signature"; message: string }
  | MappedVerifyError
  | MappedSettleError
  | {
      kind: "db_insert_failed";
      message: string;
      refundInitiated: boolean;
      refundTxHash: string | null;
    };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Full EVM register verify flow. Called when a payment header is present.
 *
 * Flow:
 *   1. Rate limit check (x402_register_verify, 5/min per IP)
 *   2. Parse request body (SIWE message + signature) and extract the payer
 *      address claimed in the SIWE message's payment payload
 *   3. Extract nonce from the SIWE message, verify SIWE fields + signature
 *      (domain, address, chainId, uri, time)
 *   4. Consume the SIWE nonce (atomic single-use marker; this is what proves
 *      the nonce was server-issued)
 *   5. Check if the wallet already exists (idempotent retry, no charge)
 *   6. verifyPayment (facilitator + KYT)
 *   7. settlePayment (on-chain USDC transfer)
 *   8. insertRegisterAtomic (register_wallet_atomic RPC)
 *   9. If the DB insert fails post-settle: refundPayment, report whether the
 *      refund actually succeeded
 *
 * Residual risk (accepted at the June 2026 checkpoint, Phase 4.4 item): the
 * atomic RPC inserts everything after settle, so a process crash between
 * steps 7 and 8 leaves a settled payment with no DB row. The refund path
 * below only covers insert FAILURES, not crashes.
 */
export async function handleRegisterVerify(
  request: NextRequest,
  paymentHeader: string,
  context: RegisterNetworkContext
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

  // ── 2. Extract payer address from payment payload ──────────────────
  // The address is the unverified claim inside the header; the SIWE
  // signature check below binds it to a key the caller actually controls,
  // and verifyPayment later confirms it against the facilitator.
  const decodeResult = decodePaymentHeader(paymentHeader);
  if (!decodeResult.ok) {
    return { ok: false, error: decodeResult.error };
  }
  const payerAddress = decodeResult.payerAddress;

  // ── 3. Parse request body ──────────────────────────────────────────
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

  // ── 4. Extract nonce from SIWE message ─────────────────────────────
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

  // ── 5. Verify SIWE message + signature ─────────────────────────────
  const siweResult = await verifySiweAuth({
    message: siweMessage,
    signature: siweSignature as `0x${string}`,
    expectedAddress: payerAddress as `0x${string}`,
    network: context.network,
    expectedDomain: context.expectedDomain,
    expectedUri: context.resourceUrl,
  });

  if (!siweResult.ok) {
    return { ok: false, error: mapSiweError(siweResult.error) };
  }

  // ── 6. Consume SIWE nonce ──────────────────────────────────────────
  // This proves the nonce was server-issued, unused, and unexpired, and
  // burns it atomically. Recording the consuming wallet gives the audit
  // trail a subject.
  const nonceResult = await consumeSiweNonce(siweNonce, payerAddress);
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

  // ── 7. Check existing wallet (idempotent retry) ────────────────────
  // If the wallet already exists, return 200 OK without settling. The
  // agent's payment authorization is NOT claimed; it expires or can be
  // reused for the next operation. This prevents double-charging on
  // idempotent retries. Fail closed on a lookup error: charging a wallet
  // that may already be registered forces a charge-then-refund round trip.
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

  // ── 8. Read pricing ────────────────────────────────────────────────
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

  // ── 9. Verify payment (facilitator + KYT) ──────────────────────────
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

  // ── 10. Settle payment (on-chain USDC transfer) ────────────────────
  const settleResult = await settlePayment({
    paymentHeader,
    network: context.network,
  });

  if (!settleResult.ok) {
    return { ok: false, error: mapSettlePaymentError(settleResult.error) };
  }

  // ── 11. Build the settlement response header ───────────────────────
  const settleResponse: SettleResponse = {
    success: true,
    payer: verifyResult.payerAddress,
    transaction: settleResult.txHash,
    network: context.network.caipNetwork as `${string}:${string}`,
    amount: usdcToAtomic(registerPrice, context.network.usdcDecimals),
  };
  const settleResponseHeader = encodePaymentResponseHeader(settleResponse);

  // ── 12. Generate principalId ───────────────────────────────────────
  const principalId = `wallet_${randomBytes(16).toString("hex")}`;

  // ── 13. Atomic DB insert ───────────────────────────────────────────
  // network/asset/facilitator store DB short names ("base", "USDC",
  // "coinbase_cdp"); CAIP-2 lives only at the SDK boundary (networks.ts).
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
    chargeNetwork: context.network.name,
    chargeAsset: "USDC",
    chargePayerAddress: verifyResult.payerAddress,
    chargeRecipientAddress: context.recipientAddress,
    chargeFacilitator: FACILITATOR_NAME,
    chargeSettledAt: settleResult.settledAt,
    sanctionsSource: "cdp_kyt",
  });

  if (!insertResult.ok) {
    // DB insert failed post-settle: MUST refund.
    console.error(`[handleRegisterVerify] DB insert failed after settle (txHash=${settleResult.txHash}). Initiating refund. Error: ${insertResult.error.message}`);

    const refundResult = await refundPayment({
      originalTxHash: settleResult.txHash,
      payerAddress: verifyResult.payerAddress,
      amountUsdc: verifyResult.chargeAmountUsdc,
      network: context.network,
      reason: "db_insert_failed_post_settle",
    });

    if (refundResult.ok) {
      console.log(`[handleRegisterVerify] Refund succeeded: ${refundResult.refundTxHash}`);
    } else {
      // Settled money with no charge row and no refund: the tx hash in this
      // log line is the only reconciliation trail. Phase 4.4 owns tooling.
      console.error(`[handleRegisterVerify] REFUND FAILED after settle (txHash=${settleResult.txHash}): ${refundResult.error.message}`);
    }

    return {
      ok: false,
      error: {
        kind: "db_insert_failed",
        message:
          insertResult.error.message ??
          "DB insert failed after settlement.",
        refundInitiated: refundResult.ok,
        refundTxHash: refundResult.ok ? refundResult.refundTxHash : null,
      },
    };
  }

  // ── 14. Success ────────────────────────────────────────────────────
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

/** Decodes the payment header far enough to get the claimed payer address. */
function decodePaymentHeader(
  paymentHeader: string
):
  | { ok: true; payerAddress: string }
  | { ok: false; error: RegisterVerifyError } {
  let payerAddress: string | null = null;
  try {
    payerAddress = extractPayerAddress(
      decodePaymentSignatureHeader(paymentHeader)
    );
  } catch (err) {
    console.error("[handleRegisterVerify] Failed to decode payment header:", err instanceof Error ? err.message : err);
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

  return { ok: true, payerAddress };
}

/**
 * Look up an existing wallet by address. EVM addresses are stored lowercase
 * at registration, so the lookup lowercases and uses exact equality; ILIKE
 * is never used here because % and _ in a crafted address would act as SQL
 * wildcards. A read error is reported, not swallowed, so the caller can
 * refuse to charge a possibly-registered wallet.
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
    .eq("address", address.toLowerCase())
    .maybeSingle();

  if (error) {
    console.error(`[handleRegisterVerify] DB error checking existing wallet: ${error.message}`);
    return { ok: false };
  }

  return { ok: true, wallet };
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
    case "uri_mismatch":
      return {
        kind: "siwe_uri_mismatch",
        expected: error.expected,
        received: error.received,
      };
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
