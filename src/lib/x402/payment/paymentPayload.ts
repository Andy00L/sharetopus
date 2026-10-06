import "server-only";

import { createHash } from "node:crypto";
import {
  getBase58Decoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import type { PaymentPayload } from "@x402/core/types";
import { readCachedSolanaSigners } from "@/lib/x402/solana/feePayer";

// A Solana wire transaction caps at 1232 bytes (~1644 base64 chars); this bounds decoder work on hostile input.
const MAX_SVM_TRANSACTION_BASE64_CHARS = 4096;

/** Prefix that keeps Solana signature nonces apart from EVM hex nonces. */
const SVM_NONCE_PREFIX = "svm:";

/**
 * Replay nonce from the payment payload: the EIP-3009 or Permit2 nonce on EVM,
 * the payer's signature on Solana (ed25519 signatures are deterministic). Null when none.
 */
export function extractNonceFromPayload(payload: PaymentPayload): string | null {
  const inner = readInnerPayload(payload);
  if (!inner) return null;

  const authorization = inner.authorization;
  if (typeof authorization === "object" && authorization !== null && "nonce" in authorization) {
    const nonce = authorization.nonce;
    if (typeof nonce === "string") return nonce;
  }

  const permit2Authorization = inner.permit2Authorization;
  if (
    typeof permit2Authorization === "object" &&
    permit2Authorization !== null &&
    "nonce" in permit2Authorization
  ) {
    const nonce = permit2Authorization.nonce;
    if (typeof nonce === "string") return nonce;
  }

  if (typeof inner.transaction === "string") {
    const payerSignature = decodeSvmPayerSignature(inner.transaction);
    if (payerSignature) return `${SVM_NONCE_PREFIX}${payerSignature}`;
  }

  return null;
}

/** Replay key for payloads without a nonce: the SHA-256 of the raw payment header. */
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
 * Base58 signature of the one required signer that is not a facilitator fee
 * payer. With no recognized fee payer, the SVM exact scheme puts it at index 0.
 */
function decodeSvmPayerSignature(transactionBase64: string): string | null {
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
    return signatureBytes ? getBase58Decoder().decode(signatureBytes) : null;
  } catch (err) {
    console.warn(
      `[decodeSvmPayerSignature] Failed to decode transaction: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
