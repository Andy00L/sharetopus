import "server-only";

import type { Address, Hex } from "viem";

import { broadcastCall, type OperatorSigner } from "@/lib/x402/chain/broadcastCall";
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

/**
 * outcome_unknown: the refund may still land. txHash is the signed
 * transaction when the sender computed one (Celo, Arc), null when the send
 * never returned one (CDP).
 */
export type RefundSendResult =
  | { status: "sent"; txHash: string }
  | { status: "not_sent"; message: string }
  | { status: "outcome_unknown"; txHash: string | null; message: string };

/** A USDC transfer from a wallet Sharetopus signs for itself (Celo, Arc). */
export async function sendOperatorRefund(params: {
  signer: OperatorSigner;
  call: { to: Address; data: Hex };
  input: RefundSendInput;
}): Promise<RefundSendResult> {
  const { signer, call, input } = params;
  const broadcast = await broadcastCall(signer, call, "refund");
  switch (broadcast.status) {
    case "accepted":
      console.log(
        `[sendOperatorRefund] Refund sent on ${signer.chain.name}: ${broadcast.transactionHash}, amount: ${input.amountUsdc} USDC, reason: ${input.reason}`,
      );
      return { status: "sent", txHash: broadcast.transactionHash };
    case "delivery_unknown":
      return { status: "outcome_unknown", txHash: broadcast.transactionHash, message: broadcast.message };
    case "rejected":
      console.error(`[sendOperatorRefund] Refund on ${signer.chain.name} not sent: ${broadcast.message}`);
      return { status: "not_sent", message: broadcast.message };
    default: {
      const unhandledBroadcast: never = broadcast;
      return { status: "not_sent", message: `Unhandled broadcast result ${JSON.stringify(unhandledBroadcast)}.` };
    }
  }
}
