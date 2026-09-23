import "server-only";

/**
 * Sends a USDC ERC-20 refund on Arc.
 *
 * No facilitator handles merchant to agent transfers, and the CDP SDK cannot
 * send on Arc (its EVM network union is base | polygon | arbitrum). The
 * refund is signed with the Arc operations key, the same wallet that
 * received the payment as X402_RECIPIENT_ARC, and goes through the same
 * broadcaster as settlements (chain/broadcastCall.ts) so the two cannot
 * collide on the wallet's nonce. Gas is USDC and comes out of the same
 * balance, so the wallet keeps a float above the largest refund.
 *
 * Called by: facilitator.refundPayment (arc_local lane)
 * Tables touched: none
 * Env: X402_ARC_KEY via arc/arcChain.ts
 */

import { getArcSigner } from "@/lib/x402/arc/arcChain";
import { broadcastCall } from "@/lib/x402/chain/broadcastCall";
import type { RefundSendInput, RefundSendResult } from "@/lib/x402/chain/refundSender";
import { buildUsdcTransferCall } from "@/lib/x402/chain/usdcTransfer";

export async function refundArc(input: RefundSendInput): Promise<RefundSendResult> {
  const { network } = input;
  if (network.family !== "evm") {
    return { ok: false, message: "Arc refunds need an EVM network entry." };
  }

  const signerResult = getArcSigner();
  if (!signerResult.ok) {
    return { ok: false, message: signerResult.message };
  }

  const transfer = buildUsdcTransferCall({
    network,
    recipientAddress: input.payerAddress,
    amountUsdc: input.amountUsdc,
  });
  if (!transfer.ok) return transfer;

  try {
    const refundTxHash = await broadcastCall(
      signerResult.signer,
      { to: transfer.usdcContract, data: transfer.calldata },
      "refund",
    );
    console.log(
      `[refundArc] Refund sent: ${refundTxHash}, amount: ${input.amountUsdc} USDC, reason: ${input.reason}`,
    );
    return { ok: true, txHash: refundTxHash };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error during the Arc refund.";
    console.error(`[refundArc] Failed: ${message}`);
    return { ok: false, message };
  }
}
