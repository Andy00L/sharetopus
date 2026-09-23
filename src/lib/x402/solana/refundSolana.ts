import "server-only";

/**
 * Sends a USDC SPL token refund on Solana.
 *
 * Builds an SPL Token TransferChecked instruction (solana/splToken.ts) from
 * the Server Wallet's associated token account (ATA) to the payer's ATA,
 * compiles it with @solana/kit, and hands the base64 wire transaction to
 * CDP for signing and sending (the CDP Server Wallet holds the key). The
 * owner is the only signer and CDP supplies that signature.
 *
 * Called by: facilitator.refundPayment (coinbase_cdp lane, Solana)
 * Env: X402_RECIPIENT_SOLANA (refund sender = original payment recipient),
 *      X402_SOLANA_RPC_URL (blockhash reads, resolved by config.getRpcUrl)
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

import { getCdpClient } from "@/lib/x402/cdp/cdpClient";
import type { RefundSendInput, RefundSendResult } from "@/lib/x402/chain/refundSender";
import { getRecipientAddress, getRpcUrl } from "@/lib/x402/config";
import {
  buildTransferCheckedInstruction,
  findAssociatedTokenAddress,
} from "@/lib/x402/solana/splToken";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";

export async function refundSolana(input: RefundSendInput): Promise<RefundSendResult> {
  // The Server Wallet that received the payment is the refund sender.
  const senderAddress = getRecipientAddress(input.network);
  if (!senderAddress) {
    return {
      ok: false,
      message: `${input.network.recipientEnvVar} env var not set. Cannot issue the Solana refund.`,
    };
  }

  const cdpResult = getCdpClient();
  if (!cdpResult.ok) return { ok: false, message: cdpResult.message };

  try {
    const rpc = createSolanaRpc(getRpcUrl(input.network));

    // Get a recent blockhash for the transaction lifetime.
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    const senderAddr = address(senderAddress);
    const recipientAddr = address(input.payerAddress);
    const usdcMint = address(input.network.usdcAddress);

    const sourceAta = await findAssociatedTokenAddress(senderAddr, usdcMint);
    // The payer's ATA exists: the payment being refunded was sent FROM it,
    // and SPL token accounts are not closed by outgoing transfers here.
    const destinationAta = await findAssociatedTokenAddress(recipientAddr, usdcMint);

    const atomicAmount = BigInt(
      usdcToAtomic(input.amountUsdc, input.network.usdcDecimals),
    );
    if (atomicAmount <= BigInt(0)) {
      return { ok: false, message: "Refund amount rounds to zero USDC." };
    }

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
          createTransactionMessage({ version: 0 }),
        ),
      ),
    );

    const compiledTx = compileTransaction(txMessage);
    const base64Tx = getBase64EncodedWireTransaction(compiledTx);

    // Sign and send via CDP. The CDP SDK's Solana network name matches the
    // WalletChain short name "solana"; the registry has no Solana testnet.
    const result = await cdpResult.client.solana.sendTransaction({
      network: "solana",
      transaction: base64Tx,
    });

    console.log(
      `[refundSolana] Refund sent: ${result.signature}, amount: ${input.amountUsdc} USDC, reason: ${input.reason}`,
    );
    return { ok: true, txHash: result.signature };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error during the Solana refund.";
    console.error(`[refundSolana] Failed: ${message}`);
    return { ok: false, message };
  }
}
