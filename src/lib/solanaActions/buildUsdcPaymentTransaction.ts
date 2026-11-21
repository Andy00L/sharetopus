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

import { getRpcUrl } from "@/lib/x402/config";
import type { NetworkConfig } from "@/lib/x402/networks";
import { buildUsdcTransferInstructions } from "@/lib/x402/solana/splToken";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";

export type BuildUsdcPaymentTransactionResult =
  | { ok: true; transactionBase64: string }
  | { ok: false; reason: "blockhash_unavailable" | "invalid_amount"; message: string };

type LatestBlockhash = Readonly<{ blockhash: Blockhash; lastValidBlockHeight: bigint }>;

const BLOCKHASH_REQUEST_TIMEOUT_MS = 5_000;

export async function buildUsdcPaymentTransaction(params: {
  payerAddress: string;
  recipientAddress: string;
  amountUsdc: number;
  network: NetworkConfig;
}): Promise<BuildUsdcPaymentTransactionResult> {
  const atomicAmount = usdcToAtomic(params.amountUsdc, params.network.usdcDecimals);
  if (!atomicAmount.ok) return { ok: false, reason: "invalid_amount", message: atomicAmount.message };

  const payer = address(params.payerAddress);
  const paymentInstructions = await buildUsdcTransferInstructions({
    sender: payer,
    recipient: address(params.recipientAddress),
    mint: address(params.network.usdcAddress),
    atomicAmount: atomicAmount.atomicAmount,
    decimals: params.network.usdcDecimals,
  });

  const blockhashResult = await readLatestBlockhash(getRpcUrl(params.network));
  if (!blockhashResult.ok) return blockhashResult;

  const transactionMessage = appendTransactionMessageInstructions(
    paymentInstructions,
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
      .send({ abortSignal: AbortSignal.timeout(BLOCKHASH_REQUEST_TIMEOUT_MS) });
    return { ok: true, latestBlockhash };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Blockhash read failed.";
    console.error(`[readLatestBlockhash] ${message}`);
    return { ok: false, reason: "blockhash_unavailable", message };
  }
}
