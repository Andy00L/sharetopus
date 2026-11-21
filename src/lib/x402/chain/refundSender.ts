import "server-only";

import type { NetworkConfig } from "@/lib/x402/networks";

/**
 * Shared contract for the per-lane refund senders (CDP EVM, Celo, Arc,
 * Solana). A sender only builds and broadcasts; facilitator.refundPayment
 * confirms the transaction on-chain before anything is recorded as refunded.
 */
export interface RefundSendInput {
  /** Refund destination: the payer the facilitator recovered at verify. */
  payerAddress: string;
  /** Amount in USDC units (human, not atomic). */
  amountUsdc: number;
  network: NetworkConfig;
  /** Why the refund is owed. Logged for observability. */
  reason: string;
  /**
   * The charge id, sent as CDP's X-Idempotency-Key: the CDP SDK's axios-retry
   * resends a POST after a network error, and CDP answers a repeated key with
   * the first response instead of sending twice.
   */
  idempotencyKey: string;
}

export type RefundSendResult =
  | { ok: true; txHash: string }
  | { ok: false; message: string };
