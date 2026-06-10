import "server-only";

/**
 * Shared extractors for x402 PaymentPayload contents.
 *
 * The payer address lives at payload.authorization.from for the EVM exact
 * scheme (EIP-3009) and at payload.payer for SVM-style payloads. The replay
 * nonce lives at payload.authorization.nonce (EIP-3009) or
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
import type { PaymentPayload } from "@x402/core/types";

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
  }
  return null;
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
