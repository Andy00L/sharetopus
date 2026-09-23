import "server-only";

/**
 * Shared extractors for x402 PaymentPayload contents.
 *
 * The payer address lives at payload.authorization.from for the EVM exact
 * scheme (EIP-3009), at payload.payer for payloads that carry one, or inside
 * the partially signed transaction for the v2 SVM exact scheme (the payload
 * is exactly { transaction: "<base64 wire tx>" }; the payer is the required
 * signer that is not the facilitator's fee payer).
 *
 * The replay nonce is payload.authorization.nonce (EIP-3009),
 * payload.permit2Authorization.nonce (Permit2), or on Solana the payer's own
 * signature over the transaction message: ed25519 signatures are
 * deterministic, so the same payment always yields the same key, while the
 * surrounding JSON and base64 can be re-encoded freely without changing it.
 * Only payloads with none of these fall back to a digest of the raw header.
 *
 * Called by: facilitator.ts, connect verify flow
 * Tables touched: none
 */

import { createHash } from "node:crypto";
import {
  getBase58Decoder,
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

/** Prefix that keeps Solana signature nonces apart from EVM hex nonces. */
const SVM_NONCE_PREFIX = "svm:";

/** Payer wallet address as claimed inside the payment payload, or null. */
export function extractPayerAddress(payload: PaymentPayload): string | null {
  const inner = readInnerPayload(payload);
  if (!inner) return null;

  const authorization = inner.authorization;
  if (typeof authorization === "object" && authorization !== null && "from" in authorization) {
    const from = authorization.from;
    if (typeof from === "string") return from;
  }
  if (typeof inner.payer === "string") return inner.payer;
  if (typeof inner.transaction === "string") {
    return decodeSvmPayerSignature(inner.transaction)?.payerAddress ?? null;
  }
  return null;
}

/** Scheme-level replay nonce from the payment payload, or null. */
export function extractNonceFromPayload(payload: PaymentPayload): string | null {
  const inner = readInnerPayload(payload);
  if (!inner) return null;

  // EVM EIP-3009 exact scheme: payload.authorization.nonce
  const authorization = inner.authorization;
  if (typeof authorization === "object" && authorization !== null && "nonce" in authorization) {
    const nonce = authorization.nonce;
    if (typeof nonce === "string") return nonce;
  }

  // Permit2 scheme: payload.permit2Authorization.nonce
  const permit2Authorization = inner.permit2Authorization;
  if (
    typeof permit2Authorization === "object" &&
    permit2Authorization !== null &&
    "nonce" in permit2Authorization
  ) {
    const nonce = permit2Authorization.nonce;
    if (typeof nonce === "string") return nonce;
  }

  // SVM exact scheme: the payer's signature over the transaction message.
  if (typeof inner.transaction === "string") {
    const payerSignature = decodeSvmPayerSignature(inner.transaction)?.signatureBase58;
    if (payerSignature) return `${SVM_NONCE_PREFIX}${payerSignature}`;
  }

  return null;
}

/**
 * Deterministic replay key for payloads without an extractable nonce: the
 * SHA-256 of the raw payment header.
 */
export function fallbackNonceFromHeader(paymentHeader: string): string {
  return createHash("sha256").update(paymentHeader).digest("hex");
}

/** payload.payload as a plain object, or null. */
function readInnerPayload(payload: PaymentPayload): Record<string, unknown> | null {
  const inner: unknown = payload.payload;
  if (typeof inner !== "object" || inner === null || Array.isArray(inner)) return null;
  return Object.fromEntries(Object.entries(inner));
}

/**
 * Payer and payer signature from a v2 SVM exact-scheme payload: decode the
 * base64 wire transaction, take the static account keys in the
 * required-signer range, drop every facilitator signer (cached from
 * /supported; the advertised fee payer rotates within that set), and
 * require exactly one signer to remain. When no facilitator signer is
 * recognized (empty cache or full rotation), fall back to position: the SVM
 * exact scheme places the fee payer at static account index 0 (verified
 * against a fixture built by the official @x402/svm client, June 2026).
 *
 * This is an unverified claim that the facilitator verify binds afterwards,
 * the same trust level as the EVM authorization.from read.
 */
function decodeSvmPayerSignature(
  transactionBase64: string,
): { payerAddress: string; signatureBase58: string | null } | null {
  if (transactionBase64.length > MAX_SVM_TRANSACTION_BASE64_CHARS) {
    console.warn(
      `[decodeSvmPayerSignature] Transaction base64 is ${transactionBase64.length} chars (cap ${MAX_SVM_TRANSACTION_BASE64_CHARS}); rejecting.`,
    );
    return null;
  }

  try {
    const wireBytes = new Uint8Array(Buffer.from(transactionBase64, "base64"));
    const transaction = getTransactionDecoder().decode(wireBytes);
    const compiledMessage = getCompiledTransactionMessageDecoder().decode(
      transaction.messageBytes,
    );
    const requiredSigners = compiledMessage.staticAccounts.slice(
      0,
      compiledMessage.header.numSignerAccounts,
    );

    const facilitatorSigners = new Set<string>(readCachedSolanaSigners());
    const hasRecognizedFeePayer = requiredSigners.some((signerAddress) =>
      facilitatorSigners.has(signerAddress),
    );
    const payerCandidates = hasRecognizedFeePayer
      ? requiredSigners.filter((signerAddress) => !facilitatorSigners.has(signerAddress))
      : requiredSigners.slice(1);

    const payerAddress = payerCandidates[0];
    if (payerCandidates.length !== 1 || payerAddress === undefined) {
      console.warn(
        `[decodeSvmPayerSignature] Expected exactly one payer signer; transaction has ${requiredSigners.length} required signer(s), ${payerCandidates.length} after fee-payer removal.`,
      );
      return null;
    }

    const signatureBytes = transaction.signatures[payerAddress];
    return {
      payerAddress,
      signatureBase58: signatureBytes ? getBase58Decoder().decode(signatureBytes) : null,
    };
  } catch (err) {
    console.warn(
      `[decodeSvmPayerSignature] Failed to decode transaction: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
