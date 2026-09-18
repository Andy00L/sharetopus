import "server-only";

/**
 * Send a USDC ERC-20 refund on Arc.
 *
 * Same reason as Celo: no facilitator handles merchant->agent, and the CDP
 * SDK cannot send on Arc (its EVM network union is base | polygon |
 * arbitrum). The refund is signed locally with the Arc operations key, which
 * is the same wallet that received the payment as X402_RECIPIENT_ARC and
 * already holds the USDC being returned.
 *
 * Called by: facilitator.ts refundPayment (Arc branch, dynamic import)
 * Tables touched: none
 * Env: X402_ARC_KEY via arc/arcChain.ts
 */

import {
  EVM_ADDRESS_PATTERN,
  createArcWalletClient,
  loadArcOperationsAccount,
} from "@/lib/x402/arc/arcChain";
import { encodeErc20TransferCalldata } from "@/lib/x402/facilitator";
import type { NetworkConfig } from "@/lib/x402/networks";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RefundArcInput {
  payerAddress: string;
  amountUsdc: number;
  network: NetworkConfig;
  reason: string;
}

export type RefundArcResult =
  | { ok: true; refundTxHash: string }
  | {
      ok: false;
      error: { kind: "build_failed" | "send_failed"; message: string };
    };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export async function refundArc(
  input: RefundArcInput,
): Promise<RefundArcResult> {
  const accountResult = loadArcOperationsAccount();
  if (!accountResult.ok) {
    return {
      ok: false,
      error: { kind: "build_failed", message: accountResult.message },
    };
  }
  if (!EVM_ADDRESS_PATTERN.test(input.payerAddress)) {
    return {
      ok: false,
      error: {
        kind: "build_failed",
        message:
          "Payer address is not a valid EVM address; refusing to build the Arc refund.",
      },
    };
  }

  try {
    const walletClient = createArcWalletClient(
      input.network,
      accountResult.account,
    );

    const atomicAmount = BigInt(
      usdcToAtomic(input.amountUsdc, input.network.usdcDecimals),
    );
    const calldata = encodeErc20TransferCalldata(
      input.payerAddress,
      atomicAmount,
    );

    // The gas this transaction burns is USDC too, taken from the same
    // balance the refund comes out of, so a wallet holding exactly the
    // refund amount cannot pay it back. The operations float covers that.
    const refundTxHash = await walletClient.sendTransaction({
      account: accountResult.account,
      chain: walletClient.chain,
      to: input.network.usdcAddress as `0x${string}`,
      data: calldata,
      value: BigInt(0),
    });

    console.log(
      `[refundArc] Refund sent: ${refundTxHash}, amount: ${input.amountUsdc} USDC, reason: ${input.reason}`,
    );

    return { ok: true, refundTxHash };
  } catch (err) {
    console.error(
      "[refundArc] Failed:",
      err instanceof Error ? err.message : err,
    );
    return {
      ok: false,
      error: {
        kind: "send_failed",
        message:
          err instanceof Error
            ? err.message
            : "Unexpected error during Arc refund.",
      },
    };
  }
}
