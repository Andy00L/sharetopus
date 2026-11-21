import "server-only";

import type { CdpClient } from "@coinbase/cdp-sdk";
import { isAddress } from "viem";

import { getCdpClient, sendThroughCdp } from "@/lib/x402/cdp/cdpClient";
import type { RefundSendInput, RefundSendResult } from "@/lib/x402/chain/refundSender";
import { buildUsdcTransferCall } from "@/lib/x402/chain/usdcTransfer";
import { getRecipientAddress } from "@/lib/x402/config";
import type { EvmNetworkConfig } from "@/lib/x402/networks";

type CdpEvmSendNetwork = Parameters<CdpClient["evm"]["sendTransaction"]>[0]["network"];

const CDP_EVM_NETWORK_NAMES = ["base", "polygon", "arbitrum"] as const satisfies readonly CdpEvmSendNetwork[];

type CdpEvmNetworkName = (typeof CDP_EVM_NETWORK_NAMES)[number];

function isCdpEvmNetworkName(networkName: string): networkName is CdpEvmNetworkName {
  return CDP_EVM_NETWORK_NAMES.some((cdpNetworkName) => cdpNetworkName === networkName);
}

export async function refundCdpEvm(
  input: RefundSendInput,
  network: EvmNetworkConfig,
): Promise<RefundSendResult> {
  const networkName = network.name;
  if (!isCdpEvmNetworkName(networkName)) {
    return { status: "not_sent", message: `The CDP SDK cannot send refunds on ${network.displayName}.` };
  }

  const senderAddress = getRecipientAddress(network);
  if (!senderAddress || !isAddress(senderAddress, { strict: false })) {
    return {
      status: "not_sent",
      message: `${network.recipientEnvVar} is not set to a valid EVM address; cannot issue the refund.`,
    };
  }

  const transfer = buildUsdcTransferCall({
    network,
    recipientAddress: input.payerAddress,
    amountUsdc: input.amountUsdc,
  });
  if (!transfer.ok) return { status: "not_sent", message: transfer.message };

  const cdpResult = getCdpClient();
  if (!cdpResult.ok) return { status: "not_sent", message: cdpResult.message };
  const cdpClient = cdpResult.client;

  const sendResult = await sendThroughCdp({
    send: async () => {
      const sentTransaction = await cdpClient.evm.sendTransaction({
        address: senderAddress,
        transaction: {
          to: transfer.usdcContract,
          data: transfer.calldata,
          value: BigInt(0),
        },
        network: networkName,
        idempotencyKey: input.idempotencyKey,
      });
      return sentTransaction.transactionHash;
    },
    operationName: `CDP refund send on ${network.displayName}`,
  });
  if (sendResult.status === "sent") {
    console.log(
      `[refundCdpEvm] Refund sent: ${sendResult.txHash}, amount: ${input.amountUsdc} USDC on ${network.displayName}, reason: ${input.reason}`,
    );
  }
  return sendResult;
}
