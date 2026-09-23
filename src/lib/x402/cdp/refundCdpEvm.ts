import "server-only";

/**
 * Sends a USDC refund from the CDP Server Wallet on base, polygon or
 * arbitrum. The wallet that received the payment (X402_RECIPIENT_EVM) is the
 * sender, and CDP holds its key.
 *
 * Called by: facilitator.refundPayment (coinbase_cdp lane, EVM networks)
 * Tables touched: none
 */

import { isAddress } from "viem";

import { getCdpClient } from "@/lib/x402/cdp/cdpClient";
import type { RefundSendInput, RefundSendResult } from "@/lib/x402/chain/refundSender";
import { buildUsdcTransferCall } from "@/lib/x402/chain/usdcTransfer";
import { getRecipientAddress } from "@/lib/x402/config";
import type { EvmNetworkConfig } from "@/lib/x402/networks";

/** EVM networks the CDP SDK can send on. sourceRef: @coinbase/cdp-sdk evm.sendTransaction network union. */
const CDP_EVM_NETWORK_NAMES = ["base", "polygon", "arbitrum"] as const;

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
    return { ok: false, message: `The CDP SDK cannot send refunds on ${network.displayName}.` };
  }

  const senderAddress = getRecipientAddress(network);
  if (!senderAddress || !isAddress(senderAddress, { strict: false })) {
    return {
      ok: false,
      message: `${network.recipientEnvVar} is not set to a valid EVM address; cannot issue the refund.`,
    };
  }

  const transfer = buildUsdcTransferCall({
    network,
    recipientAddress: input.payerAddress,
    amountUsdc: input.amountUsdc,
  });
  if (!transfer.ok) return transfer;

  const cdpResult = getCdpClient();
  if (!cdpResult.ok) return { ok: false, message: cdpResult.message };

  try {
    const result = await cdpResult.client.evm.sendTransaction({
      address: senderAddress,
      transaction: {
        to: transfer.usdcContract,
        data: transfer.calldata,
        value: BigInt(0),
      },
      network: networkName,
    });
    console.log(
      `[refundCdpEvm] Refund sent: ${result.transactionHash}, amount: ${input.amountUsdc} USDC on ${network.displayName}, reason: ${input.reason}`,
    );
    return { ok: true, txHash: result.transactionHash };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error during the CDP refund.";
    console.error(`[refundCdpEvm] Failed on ${network.displayName}: ${message}`);
    return { ok: false, message };
  }
}
