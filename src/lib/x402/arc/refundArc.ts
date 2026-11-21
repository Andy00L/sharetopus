import "server-only";

import { getArcSigner } from "@/lib/x402/arc/arcChain";
import {
  sendOperatorRefund,
  type RefundSendInput,
  type RefundSendResult,
} from "@/lib/x402/chain/refundSender";
import { buildUsdcTransferCall } from "@/lib/x402/chain/usdcTransfer";

export async function refundArc(input: RefundSendInput): Promise<RefundSendResult> {
  const { network } = input;
  if (network.family !== "evm") {
    return { status: "not_sent", message: "Arc refunds need an EVM network entry." };
  }

  const signerResult = getArcSigner();
  if (!signerResult.ok) {
    return { status: "not_sent", message: signerResult.message };
  }

  const transfer = buildUsdcTransferCall({
    network,
    recipientAddress: input.payerAddress,
    amountUsdc: input.amountUsdc,
  });
  if (!transfer.ok) return { status: "not_sent", message: transfer.message };

  return sendOperatorRefund({
    signer: signerResult.signer,
    call: { to: transfer.usdcContract, data: transfer.calldata },
    input,
  });
}
