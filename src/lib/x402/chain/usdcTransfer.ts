import "server-only";

/**
 * USDC transfer helpers shared by every EVM refund sender (CDP, Celo, Arc).
 *
 * Called by: cdp/refundCdpEvm.ts, celo/refundCelo.ts, arc/refundArc.ts
 * Tables touched: none
 */

import {
  encodeFunctionData,
  erc20Abi,
  isAddress,
  type Address,
  type Hex,
} from "viem";

import type { EvmNetworkConfig } from "@/lib/x402/networks";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";

export type UsdcTransferCallResult =
  | { ok: true; recipient: Address; usdcContract: Address; calldata: Hex }
  | { ok: false; message: string };

/**
 * Builds the ERC-20 transfer(recipient, amount) call for a USDC refund.
 *
 * Addresses are checked for shape only (strict: false): a payer address
 * reported in lowercase is valid and must not block a refund on checksum
 * casing.
 */
export function buildUsdcTransferCall(params: {
  network: EvmNetworkConfig;
  recipientAddress: string;
  amountUsdc: number;
}): UsdcTransferCallResult {
  const { network, recipientAddress, amountUsdc } = params;
  if (!isAddress(recipientAddress, { strict: false })) {
    return {
      ok: false,
      message: "Payer address is not a valid EVM address; refusing to build the refund.",
    };
  }
  if (!isAddress(network.usdcAddress, { strict: false })) {
    return {
      ok: false,
      message: `USDC contract for ${network.displayName} is not a valid EVM address.`,
    };
  }

  const atomicAmount = BigInt(usdcToAtomic(amountUsdc, network.usdcDecimals));
  if (atomicAmount <= BigInt(0)) {
    return { ok: false, message: "Refund amount rounds to zero USDC." };
  }

  return {
    ok: true,
    recipient: recipientAddress,
    usdcContract: network.usdcAddress,
    calldata: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipientAddress, atomicAmount],
    }),
  };
}
