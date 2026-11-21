import "server-only";

import { createSolanaRpc, signature as toSignature } from "@solana/kit";
import type { Signature } from "@solana/kit";

import { pollUntilDeadline } from "@/lib/x402/chain/pollUntilDeadline";
import { getRpcUrl } from "@/lib/x402/config";
import type { NetworkConfig } from "@/lib/x402/networks";

const CONFIRMATION_TIMEOUT_MS = 12_000;
const CONFIRMATION_POLL_INTERVAL_MS = 1_500;

/** One getTransaction call; the Solana HTTP transport sets no timeout of its own. */
const RPC_REQUEST_TIMEOUT_MS = 4_000;

export type VerifyUsdcPaymentResult =
  | {
      ok: true;
      txSignature: string;
      payerAddress: string;
      atomicReceived: bigint;
      slot: bigint;
      blockTimeUnixSeconds: bigint | null;
    }
  | {
      ok: false;
      reason: "amount_short";
      message: string;
      txSignature: string;
      payerAddress: string;
      atomicReceived: bigint;
    }
  | {
      ok: false;
      reason:
        | "invalid_signature"
        | "not_found"
        | "failed_on_chain"
        | "payer_mismatch"
        | "no_usdc_credit"
        | "rpc_error";
      message: string;
    };

export async function verifyUsdcPayment(params: {
  txSignatureRaw: string;
  expectedPayerAddress: string;
  recipientAddress: string;
  usdcMint: string;
  minimumAtomicAmount: bigint;
  network: NetworkConfig;
}): Promise<VerifyUsdcPaymentResult> {
  let txSignature: Signature;
  try {
    txSignature = toSignature(params.txSignatureRaw);
  } catch {
    return {
      ok: false,
      reason: "invalid_signature",
      message: "signature is not a valid Solana transaction signature.",
    };
  }

  const rpc = createSolanaRpc(getRpcUrl(params.network));
  const pollOutcome = await pollUntilDeadline({
    timeoutMs: CONFIRMATION_TIMEOUT_MS,
    intervalMs: CONFIRMATION_POLL_INTERVAL_MS,
    requestTimeoutMs: RPC_REQUEST_TIMEOUT_MS,
    readOnce: (abortSignal) => fetchConfirmedTransaction(rpc, txSignature, abortSignal),
  });
  if (pollOutcome.status === "timed_out") {
    if (pollOutcome.lastError !== null) {
      const message = pollOutcome.lastError instanceof Error ? pollOutcome.lastError.message : "RPC read failed.";
      console.error(`[verifyUsdcPayment] getTransaction failed: ${message}`);
      return { ok: false, reason: "rpc_error", message: "Could not read the transaction from the network." };
    }
    return {
      ok: false,
      reason: "not_found",
      message: "Transaction not confirmed yet. Wait a few seconds and try again.",
    };
  }
  const transaction = pollOutcome.value;

  if (transaction.meta?.err) {
    return {
      ok: false,
      reason: "failed_on_chain",
      message: "The payment transaction failed on-chain. Nothing was charged.",
    };
  }

  // Solana's fee payer is the first required signer, static account index 0 (solana.com/docs/core/fees).
  const feePayer = transaction.transaction.message.accountKeys[0];
  if (
    !feePayer ||
    !feePayer.signer ||
    String(feePayer.pubkey) !== params.expectedPayerAddress
  ) {
    return {
      ok: false,
      reason: "payer_mismatch",
      message: "The transaction was not paid by the wallet that started this action.",
    };
  }

  const postBalance = (transaction.meta?.postTokenBalances ?? []).find(
    (balance) =>
      String(balance.mint) === params.usdcMint &&
      balance.owner !== undefined &&
      String(balance.owner) === params.recipientAddress,
  );
  if (!postBalance) {
    return {
      ok: false,
      reason: "no_usdc_credit",
      message: "The transaction did not credit USDC to Sharetopus.",
    };
  }
  const preBalance = (transaction.meta?.preTokenBalances ?? []).find(
    (balance) => balance.accountIndex === postBalance.accountIndex,
  );
  // The RPC lists no preTokenBalances entry for a token account the transaction itself created.
  const atomicBefore = BigInt(preBalance?.uiTokenAmount.amount ?? "0");
  const atomicAfter = BigInt(postBalance.uiTokenAmount.amount);
  const atomicReceived = atomicAfter - atomicBefore;
  if (atomicReceived < params.minimumAtomicAmount) {
    return {
      ok: false,
      reason: "amount_short",
      message: `The transaction paid ${atomicReceived} atomic USDC; ${params.minimumAtomicAmount} was required.`,
      txSignature: String(txSignature),
      payerAddress: String(feePayer.pubkey),
      atomicReceived,
    };
  }

  return {
    ok: true,
    txSignature: String(txSignature),
    payerAddress: String(feePayer.pubkey),
    atomicReceived,
    slot: transaction.slot,
    blockTimeUnixSeconds: transaction.blockTime ?? null,
  };
}

async function fetchConfirmedTransaction(
  rpc: ReturnType<typeof createSolanaRpc>,
  txSignature: Signature,
  abortSignal: AbortSignal,
) {
  return rpc
    .getTransaction(txSignature, {
      encoding: "jsonParsed",
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    })
    .send({ abortSignal });
}
