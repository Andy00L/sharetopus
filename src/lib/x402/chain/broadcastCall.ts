import "server-only";

/**
 * The one broadcaster for wallets Sharetopus signs with itself: the Arc
 * operations wallet (settlements and refunds) and the Celo refund wallet.
 *
 * A call is signed once and its hash computed locally, so a send whose reply
 * is lost is resent as the same bytes (same hash, so it cannot move money a
 * second time), and a transaction that may have reached a node is always
 * reported with its hash. Transport retries are off on the send and lookup
 * path: viem would otherwise resend a timed-out eth_sendRawTransaction by
 * itself and surface the node's "already known" as a failure, and a retried
 * lookup inside the resend loop would stretch one broadcast past the paid
 * routes' 60 s budget.
 *
 * Called by: arc/arcChain.ts (Arc signer), arc/arcFacilitator.ts,
 *            arc/refundArc.ts, celo/refundCelo.ts
 * Tables touched: none
 */

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

/**
 * Attempts to claim a nonce. One EOA carries one sequential nonce, so two
 * broadcasts from two serverless instances at the same moment race for it;
 * the loser signs again with the next nonce.
 */
const NONCE_CLAIM_ATTEMPTS = 3;

/** Resends of the SAME signed bytes after a transport failure. */
const RAW_RESEND_ATTEMPTS = 3;

/** Linear backoff base between attempts, in milliseconds. */
const BROADCAST_BACKOFF_MS = 200;

/** Node replies meaning these exact bytes are already in the pool. */
const ALREADY_KNOWN_MARKERS = ["already known", "already imported", "known transaction"] as const;

/** Node replies meaning another transaction holds the nonce we signed with. */
const NONCE_TAKEN_MARKERS = [
  "nonce too low",
  "nonce too high",
  "invalid nonce",
  "nonce has already been used",
  "replacement transaction underpriced",
] as const;

/**
 * An operator-held wallet and its clients on one chain.
 *
 * noRetryClient has transport retries turned off: broadcastCall alone
 * decides when signed bytes are resent or looked up.
 */
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
    noRetryClient: createPublicClient({ chain, transport: http(rpcUrl, { retryCount: 0 }) }),
  };
}

/**
 * accepted: a node holds the transaction. delivery_unknown: the signed bytes
 * may have reached a node and may still land, so transactionHash is the one
 * to watch. rejected: no transaction for this call was sent.
 */
export type BroadcastResult =
  | { status: "accepted"; transactionHash: Hex }
  | { status: "delivery_unknown"; transactionHash: Hex; message: string }
  | { status: "rejected"; message: string };

type SignedSendOutcome =
  | { status: "accepted" }
  | { status: "nonce_taken" }
  | { status: "delivery_unknown"; message: string }
  | { status: "rejected"; message: string };

type TransactionLookup = "found" | "not_found" | "lookup_failed";

/**
 * Broadcasts one call from the operator wallet without ever sending it twice.
 *
 * Before anything is re-signed, the chain is asked whether the signed hash
 * already exists. A new nonce is only taken when the node says the nonce is
 * gone AND our transaction is unknown, which means another broadcast from
 * this wallet claimed it. When a send of the bytes failed in transport and
 * the chain cannot be asked, the bytes are never re-signed: the hash comes
 * back as delivery_unknown.
 *
 * Residual: if a node accepted our bytes but the node answering the lookup
 * has not seen them yet, the call can be signed again under a new nonce.
 * For an EIP-3009 settlement only one of the two transfers can succeed; the
 * other reverts and surfaces as an indeterminate settlement in
 * reconciliation.
 */
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
      return { status: "rejected", message: signedCall.message };
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
      case "rejected":
        return { status: "rejected", message: outcome.message };
      case "nonce_taken":
        console.warn(
          `[broadcastCall] ${operationName} on ${signer.chain.name} lost its nonce to another broadcast on attempt ${attempt} of ${NONCE_CLAIM_ATTEMPTS}.`,
        );
        if (attempt < NONCE_CLAIM_ATTEMPTS) await sleep(BROADCAST_BACKOFF_MS * attempt);
        break;
      default: {
        const unhandledOutcome: never = outcome;
        return { status: "rejected", message: `Unhandled send outcome ${JSON.stringify(unhandledOutcome)}.` };
      }
    }
  }
  return {
    status: "rejected",
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
        return { status: "nonce_taken" };
      }
      if (!isTransportError) return { status: "rejected", message: describeBroadcastError(error) };

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

/** Timeouts and HTTP-level failures, where the node may or may not have the bytes. */
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

/** viem's short message and details only: its full message carries the RPC URL, which can hold an API key. */
function describeBroadcastError(error: unknown): string {
  if (!(error instanceof BaseError)) return describeError(error);
  return error.details && error.details !== error.shortMessage
    ? `${error.shortMessage} ${error.details}`
    : error.shortMessage;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
