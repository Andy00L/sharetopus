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

const SVM_NONCE_PREFIX = "svm:";

export interface PaymentIdentity {
  nonce: string | null;
  payerAddress: string | null;
}

const UNKNOWN_PAYMENT_IDENTITY: PaymentIdentity = { nonce: null, payerAddress: null };

// On Solana the payer's signature is the nonce: ed25519 signatures are deterministic (RFC 8032).
export function extractPaymentIdentity(payload: PaymentPayload): PaymentIdentity {
  const inner = readInnerPayload(payload);
  if (!inner) return UNKNOWN_PAYMENT_IDENTITY;

  const evmIdentity =
    readEvmAuthorizationIdentity(inner.authorization) ??
    readEvmAuthorizationIdentity(inner.permit2Authorization);
  if (evmIdentity) return evmIdentity;

  if (typeof inner.transaction === "string") {
    const svmPayer = decodeSvmPayer(inner.transaction);
    if (svmPayer) {
      return { nonce: `${SVM_NONCE_PREFIX}${svmPayer.signature}`, payerAddress: svmPayer.payerAddress };
    }
  }

  return UNKNOWN_PAYMENT_IDENTITY;
}

function readEvmAuthorizationIdentity(authorization: unknown): PaymentIdentity | null {
  if (typeof authorization !== "object" || authorization === null || !("nonce" in authorization)) {
    return null;
  }
  const nonce = authorization.nonce;
  if (typeof nonce !== "string") return null;
  const payerAddress = "from" in authorization ? authorization.from : null;
  return { nonce, payerAddress: typeof payerAddress === "string" ? payerAddress : null };
}

export function fallbackNonceFromHeader(paymentHeader: string): string {
  return createHash("sha256").update(paymentHeader).digest("hex");
}

function readInnerPayload(payload: PaymentPayload): Record<string, unknown> | null {
  const inner: unknown = payload.payload;
  if (typeof inner !== "object" || inner === null || Array.isArray(inner)) return null;
  return Object.fromEntries(Object.entries(inner));
}

// Solana's fee payer is the first required signer, static account index 0 (solana.com/docs/core/fees).
function decodeSvmPayer(transactionBase64: string): { payerAddress: string; signature: string } | null {
  if (transactionBase64.length > MAX_SVM_TRANSACTION_BASE64_CHARS) {
    console.warn(
      `[decodeSvmPayer] Transaction base64 is ${transactionBase64.length} chars (cap ${MAX_SVM_TRANSACTION_BASE64_CHARS}); rejecting.`,
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
        `[decodeSvmPayer] Expected exactly one payer signer; transaction has ${requiredSigners.length} required signer(s), ${payerCandidates.length} after fee-payer removal.`,
      );
      return null;
    }

    const signatureBytes = transaction.signatures[payerAddress];
    return signatureBytes ? { payerAddress, signature: getBase58Decoder().decode(signatureBytes) } : null;
  } catch (err) {
    console.warn(
      `[decodeSvmPayer] Failed to decode transaction: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
