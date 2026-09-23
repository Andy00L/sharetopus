import "server-only";

/**
 * The one broadcaster for wallets Sharetopus signs with itself: the Arc
 * operations wallet (settlements and refunds) and the Celo refund wallet.
 *
 * A call is signed once and its hash computed locally, so a send whose reply
 * is lost is resent as the same bytes (same hash, so it cannot move money a
 * second time), and a transaction that landed is always reported with its
 * hash. Transport retries are off on the send path: viem would otherwise
 * resend a timed-out eth_sendRawTransaction by itself and surface the node's
 * "already known" as a failure, recording a transfer that went out as one
 * that did not.
 *
 * Called by: arc/arcChain.ts (Arc signer), arc/arcFacilitator.ts,
 *            arc/refundArc.ts, celo/refundCelo.ts
 * Tables touched: none
 */

import {
  BaseError,
  HttpRequestError,
  TimeoutError,
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
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
 * rawSendClient has transport retries turned off so that resending is
 * decided by broadcastCall, which knows whether a resend is safe.
 */
export interface OperatorSigner {
  account: PrivateKeyAccount;
  chain: Chain;
  publicClient: PublicClient;
  walletClient: WalletClient;
  rawSendClient: WalletClient;
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
    rawSendClient: createWalletClient({ chain, transport: http(rpcUrl, { retryCount: 0 }) }),
  };
}

/**
 * Broadcasts one call from the operator wallet without ever sending it twice
 * and returns its transaction hash.
 *
 * Before anything is re-signed, the chain is asked whether the signed hash
 * already exists. A new nonce is only taken when the node says the nonce is
 * gone AND our transaction is unknown, which means another broadcast from
 * this wallet claimed it.
 *
 * Throws on a definitive failure: its callers are the x402 scheme adapter,
 * which drives errors through throws by contract, and the refund senders,
 * which catch.
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
): Promise<Hex> {
  for (let attempt = 1; attempt <= NONCE_CLAIM_ATTEMPTS; attempt += 1) {
    const request = await signer.walletClient.prepareTransactionRequest({
      account: signer.account,
      chain: signer.chain,
      to: call.to,
      data: call.data,
      ...(call.gas === undefined ? {} : { gas: call.gas }),
    });
    const serializedTransaction = await signer.walletClient.signTransaction(request);
    const transactionHash = keccak256(serializedTransaction);

    const outcome = await sendSignedTransaction(signer, serializedTransaction, transactionHash);
    if (outcome === "accepted") return transactionHash;

    console.warn(
      `[broadcastCall] ${operationName} on ${signer.chain.name} lost its nonce to another broadcast on attempt ${attempt} of ${NONCE_CLAIM_ATTEMPTS}; signing again.`,
    );
    await sleep(BROADCAST_BACKOFF_MS * attempt);
  }
  throw new Error(
    `[broadcastCall] ${operationName} on ${signer.chain.name} could not claim a nonce after ${NONCE_CLAIM_ATTEMPTS} attempts.`,
  );
}

async function sendSignedTransaction(
  signer: OperatorSigner,
  serializedTransaction: Hex,
  transactionHash: Hex,
): Promise<"accepted" | "nonce_taken"> {
  for (let resend = 1; resend <= RAW_RESEND_ATTEMPTS; resend += 1) {
    try {
      await signer.rawSendClient.sendRawTransaction({ serializedTransaction });
      return "accepted";
    } catch (error) {
      const errorText = describeError(error).toLowerCase();
      if (ALREADY_KNOWN_MARKERS.some((marker) => errorText.includes(marker))) {
        return "accepted";
      }
      // An earlier send of these bytes may have landed with its reply lost.
      if (await isTransactionKnown(signer, transactionHash)) return "accepted";
      if (NONCE_TAKEN_MARKERS.some((marker) => errorText.includes(marker))) {
        return "nonce_taken";
      }
      if (!isTransportFailure(error) || resend === RAW_RESEND_ATTEMPTS) throw error;
      console.warn(
        `[sendSignedTransaction] Transport failure sending ${transactionHash} (attempt ${resend} of ${RAW_RESEND_ATTEMPTS}); resending the same bytes.`,
      );
      await sleep(BROADCAST_BACKOFF_MS * resend);
    }
  }
  throw new Error(`[sendSignedTransaction] Exhausted resends for ${transactionHash}.`);
}

async function isTransactionKnown(signer: OperatorSigner, transactionHash: Hex): Promise<boolean> {
  try {
    await signer.publicClient.getTransaction({ hash: transactionHash });
    return true;
  } catch {
    return false;
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

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
