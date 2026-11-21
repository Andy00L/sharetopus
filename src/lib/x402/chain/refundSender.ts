import "server-only";

import type { Address, Hex } from "viem";

import { broadcastCall, type OperatorSigner } from "@/lib/x402/chain/broadcastCall";
import type { NetworkConfig } from "@/lib/x402/networks";

export interface RefundSendInput {
  payerAddress: string;
  amountUsdc: number;
  network: NetworkConfig;
  reason: string;
  idempotencyKey: string;
}

export type RefundSendResult =
  | { status: "sent"; txHash: string }
  | { status: "not_sent"; message: string }
  | { status: "outcome_unknown"; txHash: string | null; message: string };

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
    case "not_sent":
      console.error(`[sendOperatorRefund] Refund on ${signer.chain.name} not sent: ${broadcast.message}`);
      return { status: "not_sent", message: broadcast.message };
    default: {
      const unhandledBroadcast: never = broadcast;
      return { status: "not_sent", message: `Unhandled broadcast result ${JSON.stringify(unhandledBroadcast)}.` };
    }
  }
}
