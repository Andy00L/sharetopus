import "server-only";

/**
 * Sharetopus' own x402 facilitator for Arc mainnet.
 *
 * Every other network hands verify and settle to a hosted facilitator over
 * HTTP. Arc has none that serves an ordinary wallet: the CDP facilitator
 * does not list eip155:5042, and Circle's settles through Gateway against
 * pre-deposited funds rather than the agent's own USDC. So this module runs
 * the exact scheme in process, against the protocol's own implementation
 * (ExactEvmScheme from @x402/evm, version-matched to @x402/core), driven by
 * a viem-backed signer over the Arc operations key.
 *
 * The agent still pays no gas and still never broadcasts: it signs an
 * EIP-3009 authorization exactly as it would for Base, and the operations
 * wallet submits transferWithAuthorization for it. On Arc that submission
 * costs about 0.0015 USDC, because gas there is USDC itself.
 *
 * Called by: facilitatorClient.getFacilitatorClient (arc branch)
 * Tables touched: none
 * Env: X402_ARC_KEY via arc/arcChain.ts, RPC via config.getArcRpcUrl
 */

import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import type {
  Account,
  Hex,
  PublicClient,
  VerifyTypedDataActionParameters,
  WalletClient,
} from "viem";
import { publicActions } from "viem";

import {
  createArcPublicClient,
  createArcWalletClient,
  loadArcOperationsAccount,
} from "@/lib/x402/arc/arcChain";
import type { NetworkConfig } from "@/lib/x402/networks";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * A single EOA carries one sequential nonce, so two settlements broadcast at
 * the same moment from different serverless instances race for it and one is
 * rejected. Three attempts with a short backoff cover that collision; a
 * Postgres advisory lock would serialise it properly and is the upgrade path
 * if Arc volume ever makes losses visible.
 */
const NONCE_RETRY_ATTEMPTS = 3;
const NONCE_RETRY_BACKOFF_MS = 200;

/** Substrings every major client uses for a nonce collision or a resend race. */
const NONCE_CONFLICT_MARKERS = [
  "nonce too low",
  "nonce too high",
  "invalid nonce",
  "nonce has already been used",
  "replacement transaction underpriced",
  "already known",
] as const;

/** Settlement confirmation ceiling, under the 60s route budget. */
const CONFIRMATION_TIMEOUT_MS = 45_000;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

let cachedArcScheme: ExactEvmScheme | null = null;

/**
 * The Arc exact-scheme facilitator, built once per process.
 *
 * Throws when the operations key is missing or malformed, matching the
 * contract of getFacilitatorClient for the other families: callers already
 * wrap facilitator access in try/catch and map a throw to facilitator_error,
 * so a misconfigured Arc lane fails closed before any agent signs.
 */
export function getArcFacilitator(network: NetworkConfig): ExactEvmScheme {
  if (cachedArcScheme) return cachedArcScheme;

  const accountResult = loadArcOperationsAccount();
  if (!accountResult.ok) {
    throw new Error(`[getArcFacilitator] ${accountResult.message}`);
  }

  const publicClient = createArcPublicClient(network);
  const walletClient = createArcWalletClient(network, accountResult.account);
  const signer = buildArcFacilitatorSigner(
    accountResult.account,
    publicClient,
    walletClient,
  );

  cachedArcScheme = new ExactEvmScheme(signer);
  return cachedArcScheme;
}

/**
 * Adapts the viem clients to the FacilitatorEvmSigner shape @x402/evm wants.
 *
 * Written out method by method rather than handing over the client itself:
 * viem types its contract helpers against a concrete Abi while the x402
 * interface passes `readonly unknown[]`, and the broadcast methods need the
 * nonce retry wrapped around them.
 */
function buildArcFacilitatorSigner(
  account: Account,
  publicClient: PublicClient,
  walletClient: WalletClient,
): ConstructorParameters<typeof ExactEvmScheme>[0] {
  const signingClient = walletClient.extend(publicActions);
  const facilitatorAddress = account.address;

  return {
    getAddresses: () => [facilitatorAddress],

    readContract: (args) =>
      publicClient.readContract({
        address: args.address,
        abi: args.abi,
        functionName: args.functionName,
        args: args.args ? [...args.args] : undefined,
      }),

    // The x402 signer interface types the EIP-712 pieces as loose records,
    // viem types them as a concrete TypedData definition, and neither side
    // can be widened from here. The cast is the adapter boundary and holds
    // because the scheme builds these fields from the EIP-3009 typed-data
    // definition before handing them over, never from client input.
    verifyTypedData: (args) =>
      publicClient.verifyTypedData({
        address: args.address,
        domain: args.domain,
        types: args.types,
        primaryType: args.primaryType,
        message: args.message,
        signature: args.signature,
      } as VerifyTypedDataActionParameters),

    writeContract: (args) =>
      broadcastWithNonceRetry("writeContract", () =>
        signingClient.writeContract({
          account,
          chain: walletClient.chain,
          address: args.address,
          abi: args.abi,
          functionName: args.functionName,
          args: [...args.args],
          ...(args.gas === undefined ? {} : { gas: args.gas }),
        }),
      ),

    sendTransaction: (args) =>
      broadcastWithNonceRetry("sendTransaction", () =>
        signingClient.sendTransaction({
          account,
          chain: walletClient.chain,
          to: args.to,
          data: args.data,
        }),
      ),

    waitForTransactionReceipt: async (args) => {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: args.hash,
        timeout: CONFIRMATION_TIMEOUT_MS,
      });
      return { status: receipt.status, logs: receipt.logs };
    },

    getCode: (args) => publicClient.getCode({ address: args.address }),
  };
}

/**
 * Retries a broadcast that lost the race for the settler's next nonce.
 *
 * Only nonce conflicts are retried: any other failure (insufficient funds, a
 * reverted authorization, an RPC outage) is returned to the caller on the
 * first attempt, because retrying it would just delay the error the agent
 * needs to see.
 */
async function broadcastWithNonceRetry(
  operationName: string,
  broadcast: () => Promise<Hex>,
): Promise<Hex> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= NONCE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await broadcast();
    } catch (error) {
      if (!isNonceConflict(error)) throw error;
      lastError = error;
      console.warn(
        `[broadcastWithNonceRetry] ${operationName} lost the nonce race on attempt ${attempt} of ${NONCE_RETRY_ATTEMPTS}; retrying.`,
      );
      if (attempt < NONCE_RETRY_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, NONCE_RETRY_BACKOFF_MS * attempt),
        );
      }
    }
  }
  throw lastError;
}

/** True when the error text names a nonce collision or a duplicate broadcast. */
function isNonceConflict(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return NONCE_CONFLICT_MARKERS.some((marker) => message.includes(marker));
}
