import "server-only";

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
import type { Blockhash } from "@solana/kit";

import { getSolanaRpcUrl } from "@/lib/x402/config";
import type { NetworkConfig } from "@/lib/x402/networks";
import {
  buildCreateAssociatedTokenAccountIdempotentInstruction,
  buildTransferCheckedInstruction,
  findAssociatedTokenAddress,
} from "@/lib/x402/solana/splToken";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";

/**
 * Unsigned USDC payment for a Blink. The payer's wallet is the fee payer and
 * the only signer, so the wallet signs and broadcasts it itself: a Blink
 * never routes through the x402 facilitator, which co-signs as fee payer.
 * Instructions: create the recipient's USDC account if it is missing
 * (idempotent, rent paid by the payer), then TransferChecked for the exact
 * price.
 *
 * Called by: solanaActions/postNowBlink.ts
 * Tables touched: none. Network: one blockhash read on the pinned RPC.
 */

export type BuildUsdcPaymentTransactionResult =
  | { ok: true; transactionBase64: string; atomicAmount: string }
  | { ok: false; reason: "blockhash_unavailable"; message: string };

type LatestBlockhash = Readonly<{ blockhash: Blockhash; lastValidBlockHeight: bigint }>;

export async function buildUsdcPaymentTransaction(params: {
  payerAddress: string;
  recipientAddress: string;
  amountUsdc: number;
  network: NetworkConfig;
}): Promise<BuildUsdcPaymentTransactionResult> {
  const payer = address(params.payerAddress);
  const recipient = address(params.recipientAddress);
  const usdcMint = address(params.network.usdcAddress);
  const atomicAmount = usdcToAtomic(
    params.amountUsdc,
    params.network.usdcDecimals,
  );

  const [payerAta, recipientAta] = await Promise.all([
    findAssociatedTokenAddress(payer, usdcMint),
    findAssociatedTokenAddress(recipient, usdcMint),
  ]);

  const blockhashResult = await readLatestBlockhash(getSolanaRpcUrl(params.network));
  if (!blockhashResult.ok) return blockhashResult;

  const transactionMessage = appendTransactionMessageInstructions(
    [
      buildCreateAssociatedTokenAccountIdempotentInstruction({
        payer,
        ata: recipientAta,
        owner: recipient,
        mint: usdcMint,
      }),
      buildTransferCheckedInstruction({
        sourceAta: payerAta,
        mint: usdcMint,
        destinationAta: recipientAta,
        authority: payer,
        atomicAmount: BigInt(atomicAmount),
        decimals: params.network.usdcDecimals,
      }),
    ],
    setTransactionMessageLifetimeUsingBlockhash(
      blockhashResult.latestBlockhash,
      setTransactionMessageFeePayer(payer, createTransactionMessage({ version: 0 })),
    ),
  );

  return {
    ok: true,
    transactionBase64: getBase64EncodedWireTransaction(
      compileTransaction(transactionMessage),
    ),
    atomicAmount,
  };
}

async function readLatestBlockhash(
  rpcUrl: string,
): Promise<
  | { ok: true; latestBlockhash: LatestBlockhash }
  | { ok: false; reason: "blockhash_unavailable"; message: string }
> {
  try {
    const { value: latestBlockhash } = await createSolanaRpc(rpcUrl)
      .getLatestBlockhash()
      .send();
    return { ok: true, latestBlockhash };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Blockhash read failed.";
    console.error(`[readLatestBlockhash] ${message}`);
    return { ok: false, reason: "blockhash_unavailable", message };
  }
}
