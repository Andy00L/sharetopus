import "server-only";

/**
 * Send a USDC SPL token refund on Solana.
 *
 * Builds an SPL Token TransferChecked instruction (solana/splToken.ts) from
 * the Server Wallet's associated token account (ATA) to the payer's ATA,
 * compiles it with @solana/kit, and hands the base64 wire transaction to
 * CDP for signing and sending (the CDP Server Wallet holds the key). The
 * owner is the only signer and CDP supplies that signature.
 *
 * Called by: facilitator.ts refundPayment (Solana branch)
 * Env: X402_RECIPIENT_SOLANA (refund sender = original payment recipient),
 *      X402_SOLANA_RPC_URL (blockhash reads, resolved by config.getSolanaRpcUrl)
 */

import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

import type { NetworkConfig } from "@/lib/x402/networks";
import { getCdpClient } from "@/lib/x402/facilitator";
import { getRecipientAddress, getSolanaRpcUrl } from "@/lib/x402/config";
import {
  buildTransferCheckedInstruction,
  findAssociatedTokenAddress,
} from "@/lib/x402/solana/splToken";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RefundSolanaInput {
  payerAddress: string;
  amountUsdc: number;
  network: NetworkConfig;
  reason: string;
}

export type RefundSolanaResult =
  | { ok: true; refundTxHash: string }
  | {
      ok: false;
      error: { kind: "build_failed" | "send_failed"; message: string };
    };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export async function refundSolana(
  input: RefundSolanaInput
): Promise<RefundSolanaResult> {
  // The Server Wallet that received the payment is the refund sender.
  const senderAddress = getRecipientAddress(input.network);
  if (!senderAddress) {
    return {
      ok: false,
      error: {
        kind: "build_failed",
        message: "X402_RECIPIENT_SOLANA env var not set. Cannot issue Solana refund.",
      },
    };
  }

  try {
    const cdp = getCdpClient();
    const rpc = createSolanaRpc(getSolanaRpcUrl(input.network));

    // Get a recent blockhash for the transaction lifetime.
    const { value: latestBlockhash } = await rpc
      .getLatestBlockhash()
      .send();

    const senderAddr = address(senderAddress);
    const recipientAddr = address(input.payerAddress);
    const usdcMint = address(input.network.usdcAddress);

    const sourceAta = await findAssociatedTokenAddress(senderAddr, usdcMint);
    // The payer's ATA exists: the payment that is being refunded was sent
    // FROM it, and SPL token accounts are not closed by outgoing transfers
    // in this flow.
    const destinationAta = await findAssociatedTokenAddress(
      recipientAddr,
      usdcMint
    );

    const atomicAmount = BigInt(
      usdcToAtomic(input.amountUsdc, input.network.usdcDecimals)
    );

    const transferInstruction = buildTransferCheckedInstruction({
      sourceAta,
      mint: usdcMint,
      destinationAta,
      authority: senderAddr,
      atomicAmount,
      decimals: input.network.usdcDecimals,
    });

    const txMessage = appendTransactionMessageInstructions(
      [transferInstruction],
      setTransactionMessageLifetimeUsingBlockhash(
        latestBlockhash,
        setTransactionMessageFeePayer(
          senderAddr,
          createTransactionMessage({ version: 0 })
        )
      )
    );

    const compiledTx = compileTransaction(txMessage);
    const base64Tx = getBase64EncodedWireTransaction(compiledTx);

    // Sign and send via CDP. The CDP SDK's Solana network name matches the
    // WalletChain short name "solana"; the registry has no Solana testnet.
    const result = await cdp.solana.sendTransaction({
      network: "solana",
      transaction: base64Tx,
    });

    console.log(`[refundSolana] Refund sent: ${result.signature}, amount: ${input.amountUsdc} USDC, reason: ${input.reason}`);

    return { ok: true, refundTxHash: result.signature };
  } catch (err) {
    console.error("[refundSolana] Failed:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "send_failed",
        message: err instanceof Error
          ? err.message
          : "Unexpected error during Solana refund.",
      },
    };
  }
}
