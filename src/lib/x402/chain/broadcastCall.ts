import "server-only";

import {
  BaseError,
  HttpRequestError,
  TimeoutError,
  TransactionNotFoundError,
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

const NONCE_CLAIM_ATTEMPTS = 3;

const RAW_RESEND_ATTEMPTS = 3;

const BROADCAST_BACKOFF_MS = 200;

const ALREADY_KNOWN_MARKERS = ["already known", "already imported", "known transaction"] as const;

const NONCE_TAKEN_MARKERS = [
  "nonce too low",
  "nonce too high",
  "invalid nonce",
  "nonce has already been used",
  "replacement transaction underpriced",
] as const;

export interface OperatorSigner {
  account: Account;
  chain: Chain;
  publicClient: PublicClient;
  walletClient: WalletClient;
  noRetryClient: PublicClient;
}

export function buildOperatorSigner(params: {
  account: PrivateKeyAccount;
  chain: Chain;
  rpcUrl: string;
}): OperatorSigner {
  const { account, chain, rpcUrl } = params;
  return {
    account,
    chain,
    publicClient: createPublicClient({ chain, transport: http(rpcUrl) }),
    walletClient: createWalletClient({ account, chain, transport: http(rpcUrl) }),
    // viem's http transport retries 5xx, 408 and 429 replies three times by default (viem utils/buildRequest.ts shouldRetry).
    noRetryClient: createPublicClient({ chain, transport: http(rpcUrl, { retryCount: 0 }) }),
  };
}

export type BroadcastResult =
  | { status: "accepted"; transactionHash: Hex }
  | { status: "delivery_unknown"; transactionHash: Hex; message: string }
  | { status: "not_sent"; message: string };

type SignedSendOutcome =
  | { status: "accepted" }
  | { status: "nonce_taken" }
  | { status: "delivery_unknown"; message: string }
  | { status: "not_sent"; message: string };

type TransactionLookup = "found" | "not_found" | "lookup_failed";

export async function broadcastCall(
  signer: OperatorSigner,
  call: { to: Address; data: Hex; gas?: bigint },
  operationName: string,
): Promise<BroadcastResult> {
  for (let attempt = 1; attempt <= NONCE_CLAIM_ATTEMPTS; attempt += 1) {
    const signedCall = await signCall(signer, call);
    if (!signedCall.ok) {
      console.error(
        `[broadcastCall] ${operationName} on ${signer.chain.name} could not be prepared, so nothing was sent: ${signedCall.message}`,
      );
      return { status: "not_sent", message: signedCall.message };
    }

    const { serializedTransaction, transactionHash } = signedCall;
    const outcome = await sendSignedTransaction(signer, serializedTransaction, transactionHash);
    switch (outcome.status) {
      case "accepted":
        return { status: "accepted", transactionHash };
      case "delivery_unknown":
        console.error(
          `[broadcastCall] ${operationName} on ${signer.chain.name} may have been delivered as ${transactionHash}: ${outcome.message}`,
        );
        return { status: "delivery_unknown", transactionHash, message: outcome.message };
      case "not_sent":
        return { status: "not_sent", message: outcome.message };
      case "nonce_taken":
        console.warn(
          `[broadcastCall] ${operationName} on ${signer.chain.name} lost its nonce to another broadcast on attempt ${attempt} of ${NONCE_CLAIM_ATTEMPTS}.`,
        );
        if (attempt < NONCE_CLAIM_ATTEMPTS) await sleep(BROADCAST_BACKOFF_MS * attempt);
        break;
      default: {
        const unhandledOutcome: never = outcome;
        return { status: "not_sent", message: `Unhandled send outcome ${JSON.stringify(unhandledOutcome)}.` };
      }
    }
  }
  return {
    status: "not_sent",
    message: `${operationName} on ${signer.chain.name} could not claim a nonce after ${NONCE_CLAIM_ATTEMPTS} attempts.`,
  };
}

async function signCall(
  signer: OperatorSigner,
  call: { to: Address; data: Hex; gas?: bigint },
): Promise<{ ok: true; serializedTransaction: Hex; transactionHash: Hex } | { ok: false; message: string }> {
  try {
    const request = await signer.walletClient.prepareTransactionRequest({
      account: signer.account,
      chain: signer.chain,
      to: call.to,
      data: call.data,
      ...(call.gas === undefined ? {} : { gas: call.gas }),
    });
    const serializedTransaction = await signer.walletClient.signTransaction(request);
    return { ok: true, serializedTransaction, transactionHash: keccak256(serializedTransaction) };
  } catch (error) {
    return { ok: false, message: describeBroadcastError(error) };
  }
}

async function sendSignedTransaction(
  signer: OperatorSigner,
  serializedTransaction: Hex,
  transactionHash: Hex,
): Promise<SignedSendOutcome> {
  let hasEarlierSendFailedInTransport = false;
  let lastTransportFailure = "";
  for (let resend = 1; resend <= RAW_RESEND_ATTEMPTS; resend += 1) {
    try {
      await signer.noRetryClient.sendRawTransaction({ serializedTransaction });
      return { status: "accepted" };
    } catch (error) {
      const errorText = describeError(error).toLowerCase();
      if (ALREADY_KNOWN_MARKERS.some((marker) => errorText.includes(marker))) {
        return { status: "accepted" };
      }
      const lookup = await lookUpTransaction(signer, transactionHash);
      if (lookup === "found") return { status: "accepted" };

      const isTransportError = isTransportFailure(error);
      if (lookup === "lookup_failed" && (isTransportError || hasEarlierSendFailedInTransport)) {
        return {
          status: "delivery_unknown",
          message: `A send failed (${describeBroadcastError(error)}) and the chain could not be asked whether it holds the transaction.`,
        };
      }
      if (NONCE_TAKEN_MARKERS.some((marker) => errorText.includes(marker))) {
        return hasEarlierSendFailedInTransport
          ? {
              status: "delivery_unknown",
              message: `An earlier send of these bytes failed in transport and the nonce is now taken, possibly by them (${describeBroadcastError(error)}).`,
            }
          : { status: "nonce_taken" };
      }
      if (!isTransportError) return { status: "not_sent", message: describeBroadcastError(error) };

      hasEarlierSendFailedInTransport = true;
      lastTransportFailure = describeBroadcastError(error);
      if (resend < RAW_RESEND_ATTEMPTS) {
        console.warn(
          `[sendSignedTransaction] Transport failure sending ${transactionHash} (attempt ${resend} of ${RAW_RESEND_ATTEMPTS}); resending the same bytes.`,
        );
        await sleep(BROADCAST_BACKOFF_MS * resend);
      }
    }
  }
  return {
    status: "delivery_unknown",
    message: `All ${RAW_RESEND_ATTEMPTS} sends failed in transport, the last with: ${lastTransportFailure}`,
  };
}

async function lookUpTransaction(signer: OperatorSigner, transactionHash: Hex): Promise<TransactionLookup> {
  try {
    await signer.noRetryClient.getTransaction({ hash: transactionHash });
    return "found";
  } catch (error) {
    return error instanceof TransactionNotFoundError ? "not_found" : "lookup_failed";
  }
}

function isTransportFailure(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  return (
    error.walk(
      (cause) => cause instanceof HttpRequestError || cause instanceof TimeoutError,
    ) !== null
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// viem's full error message carries the RPC URL with its path and query, which can hold an API key (viem errors/request.ts).
function describeBroadcastError(error: unknown): string {
  if (!(error instanceof BaseError)) return describeError(error);
  return error.details && error.details !== error.shortMessage
    ? `${error.shortMessage} ${error.details}`
    : error.shortMessage;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
