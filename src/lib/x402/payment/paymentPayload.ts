import "server-only";

/**
 * Shared extractors for x402 PaymentPayload contents.
 *
 * The payer address lives at payload.authorization.from for the EVM exact
 * scheme (EIP-3009), at payload.payer for payloads that carry one, or inside
 * the partially signed transaction for the v2 SVM exact scheme (the payload
 * is exactly { transaction: "<base64 wire tx>" }; the payer is the required
 * signer that is not the facilitator's fee payer). The replay nonce lives at
 * payload.authorization.nonce (EIP-3009) or
 * payload.permit2Authorization.nonce (Permit2). Schemes without an
 * extractable nonce (the SVM exact scheme carries a partially signed
 * transaction instead) fall back to a digest of the raw payment header so
 * x402_charges.nonce stays unique per payment and the UNIQUE constraint
 * keeps blocking replays.
 *
 * Called by: facilitator.ts, register/connect verify flows
 * Tables touched: none
 */

import { createHash } from "node:crypto";
import {
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import type { PaymentPayload } from "@x402/core/types";
import { readCachedSolanaSigners } from "@/lib/x402/solana/feePayer";

/**
 * Upper bound on the base64 transaction accepted for local decoding. The
 * Solana wire transaction caps at 1232 bytes (~1644 base64 chars); 4096
 * leaves margin while bounding decoder work on hostile input.
 */
const MAX_SVM_TRANSACTION_BASE64_CHARS = 4096;

/** Payer wallet address as claimed inside the payment payload, or null. */
export function extractPayerAddress(payload: PaymentPayload): string | null {
  const inner = payload.payload;
  if (inner && typeof inner === "object") {
    const auth = (inner as Record<string, unknown>).authorization;
    if (auth && typeof auth === "object") {
      const from = (auth as Record<string, unknown>).from;
      if (typeof from === "string") return from;
    }
    const payer = (inner as Record<string, unknown>).payer;
    if (typeof payer === "string") return payer;

    const transaction = (inner as Record<string, unknown>).transaction;
    if (typeof transaction === "string") {
      return extractSvmPayerAddress(transaction);
    }
  }
  return null;
}

/**
 * Payer from a v2 SVM exact-scheme payload: decode the base64 wire
 * transaction, take the static account keys in the required-signer range
 * (the first header.numSignerAccounts entries), drop every facilitator
 * signer (cached from /supported; the advertised fee payer rotates within
 * that set), and require exactly one signer to remain. When no facilitator
 * signer is recognized (empty cache or full rotation), fall back to
 * position: the SVM exact scheme places the fee payer at static account
 * index 0 (verified against a fixture built by the official @x402/svm
 * client, June 2026). Static account keys are base58 strings already.
 *
 * This is the same trust level as the EVM authorization.from read: an
 * unverified claim that the SIWS signature check and the facilitator verify
 * bind afterwards.
 */
function extractSvmPayerAddress(transactionBase64: string): string | null {
  if (transactionBase64.length > MAX_SVM_TRANSACTION_BASE64_CHARS) {
    console.warn(
      `[extractSvmPayerAddress] Transaction base64 is ${transactionBase64.length} chars (cap ${MAX_SVM_TRANSACTION_BASE64_CHARS}); rejecting.`
    );
    return null;
  }

  try {
    const wireBytes = new Uint8Array(Buffer.from(transactionBase64, "base64"));
    const transaction = getTransactionDecoder().decode(wireBytes);
    const compiledMessage = getCompiledTransactionMessageDecoder().decode(
      transaction.messageBytes
    );
    const requiredSigners: readonly string[] = compiledMessage.staticAccounts.slice(
      0,
      compiledMessage.header.numSignerAccounts
    );

    const facilitatorSigners = new Set(readCachedSolanaSigners());
    const hasRecognizedFeePayer = requiredSigners.some((signerAddress) =>
      facilitatorSigners.has(signerAddress)
    );
    const payerCandidates = hasRecognizedFeePayer
      ? requiredSigners.filter(
          (signerAddress) => !facilitatorSigners.has(signerAddress)
        )
      : requiredSigners.slice(1);

    if (payerCandidates.length !== 1) {
      console.warn(
        `[extractSvmPayerAddress] Expected exactly one payer signer; transaction has ${requiredSigners.length} required signer(s), ${payerCandidates.length} after fee-payer removal.`
      );
      return null;
    }
    return payerCandidates[0];
  } catch (err) {
    console.warn(
      `[extractSvmPayerAddress] Failed to decode transaction: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

/** Scheme-level replay nonce from the payment payload, or null. */
export function extractNonceFromPayload(payload: PaymentPayload): string | null {
  const inner = payload.payload;
  if (inner && typeof inner === "object") {
    // EVM EIP-3009 exact scheme: payload.authorization.nonce
    const auth = (inner as Record<string, unknown>).authorization;
    if (auth && typeof auth === "object") {
      const nonce = (auth as Record<string, unknown>).nonce;
      if (typeof nonce === "string") return nonce;
    }

    // Permit2 scheme: payload.permit2Authorization.nonce
    const permit2Auth = (inner as Record<string, unknown>).permit2Authorization;
    if (permit2Auth && typeof permit2Auth === "object") {
      const nonce = (permit2Auth as Record<string, unknown>).nonce;
      if (typeof nonce === "string") return nonce;
    }
  }
  return null;
}

/**
 * Deterministic replay key for payloads without an extractable nonce: the
 * SHA-256 of the raw payment header. The same payload always hashes to the
 * same value, so presenting it twice still violates the x402_charges.nonce
 * UNIQUE constraint, while distinct payments get distinct keys.
 */
export function fallbackNonceFromHeader(paymentHeader: string): string {
  return createHash("sha256").update(paymentHeader).digest("hex");
}
