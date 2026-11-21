import "server-only";

/**
 * On-chain confirmation for a transaction Sharetopus sent (refunds) or a
 * facilitator reported (settlements under reconciliation).
 *
 * "wait" blocks up to the timeout for the transaction to land; "check" reads
 * its current state once, for the reconciliation sweep. Every failure to
 * learn the outcome (timeout, RPC outage, unknown hash) reports "pending",
 * never "reverted": only the chain saying the transaction failed is a
 * definitive failure.
 *
 * Called by: facilitator.refundPayment, inngest/functions/sweepX402ReconciliationCron
 * Tables touched: none
 */

import { createSolanaRpc, isSignature } from "@solana/kit";
import {
  TransactionReceiptNotFoundError,
  WaitForTransactionReceiptTimeoutError,
  createPublicClient,
  http,
  isHash,
} from "viem";

import { pollUntilDeadline } from "@/lib/x402/chain/pollUntilDeadline";
import { getRpcUrl } from "@/lib/x402/config";
import type { NetworkConfig } from "@/lib/x402/networks";

/** Ceiling for "wait" mode; every supported chain confirms well inside it. */
const DEFAULT_CONFIRMATION_TIMEOUT_MS = 20_000;

/** Solana signature-status polling cadence in "wait" mode. */
const SVM_POLL_INTERVAL_MS = 1_000;

/** One getSignatureStatuses call; the Solana HTTP transport sets no timeout of its own. */
const SVM_STATUS_REQUEST_TIMEOUT_MS = 5_000;

export type TransactionConfirmation =
  | { status: "confirmed" }
  | { status: "reverted" }
  | { status: "pending" };

export type ConfirmationMode = "wait" | "check";

export async function confirmTransaction(params: {
  network: NetworkConfig;
  txHash: string;
  mode: ConfirmationMode;
  timeoutMs?: number;
}): Promise<TransactionConfirmation> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS;
  return params.network.family === "evm"
    ? confirmEvmTransaction(params.network, params.txHash, params.mode, timeoutMs)
    : confirmSvmTransaction(params.network, params.txHash, params.mode, timeoutMs);
}

async function confirmEvmTransaction(
  network: NetworkConfig,
  txHash: string,
  mode: ConfirmationMode,
  timeoutMs: number,
): Promise<TransactionConfirmation> {
  if (!isHash(txHash)) {
    console.error(`[confirmEvmTransaction] Not a transaction hash on ${network.displayName}: ${txHash}`);
    return { status: "pending" };
  }

  const publicClient = createPublicClient({ transport: http(getRpcUrl(network)) });
  try {
    const receipt =
      mode === "wait"
        ? await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: timeoutMs })
        : await publicClient.getTransactionReceipt({ hash: txHash });
    return receipt.status === "success" ? { status: "confirmed" } : { status: "reverted" };
  } catch (error) {
    if (
      !(error instanceof WaitForTransactionReceiptTimeoutError) &&
      !(error instanceof TransactionReceiptNotFoundError)
    ) {
      console.error(
        `[confirmEvmTransaction] Receipt lookup failed for ${txHash} on ${network.displayName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { status: "pending" };
  }
}

async function confirmSvmTransaction(
  network: NetworkConfig,
  txSignature: string,
  mode: ConfirmationMode,
  timeoutMs: number,
): Promise<TransactionConfirmation> {
  if (!isSignature(txSignature)) {
    console.error(`[confirmSvmTransaction] Not a Solana signature: ${txSignature}`);
    return { status: "pending" };
  }

  const rpc = createSolanaRpc(getRpcUrl(network));
  const outcome = await pollUntilDeadline<TransactionConfirmation>({
    timeoutMs: mode === "wait" ? timeoutMs : 0,
    intervalMs: SVM_POLL_INTERVAL_MS,
    requestTimeoutMs: SVM_STATUS_REQUEST_TIMEOUT_MS,
    readOnce: async (abortSignal) => {
      const { value: statuses } = await rpc
        .getSignatureStatuses([txSignature], { searchTransactionHistory: true })
        .send({ abortSignal });
      const signatureStatus = statuses[0];
      if (!signatureStatus) return null;
      if (signatureStatus.err !== null) return { status: "reverted" };
      if (
        signatureStatus.confirmationStatus === "confirmed" ||
        signatureStatus.confirmationStatus === "finalized"
      ) {
        return { status: "confirmed" };
      }
      return null;
    },
  });

  if (outcome.status === "found") return outcome.value;
  if (outcome.lastError !== null) {
    console.error(
      `[confirmSvmTransaction] Status lookup failed for ${txSignature}: ${outcome.lastError instanceof Error ? outcome.lastError.message : String(outcome.lastError)}`,
    );
  }
  return { status: "pending" };
}
