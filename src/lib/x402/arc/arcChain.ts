import "server-only";

/**
 * Arc mainnet chain definition and the viem clients the Arc lane runs on.
 *
 * Arc is the one network where Sharetopus is its own facilitator: no hosted
 * facilitator settles a plain EIP-3009 authorization from an agent's own
 * wallet there (CDP does not list eip155:5042 at all, and Circle's own
 * facilitator settles through Gateway against pre-deposited funds). The
 * operations wallet named by X402_RECIPIENT_ARC therefore both receives
 * payments and broadcasts them, which costs it a fraction of a cent per
 * settlement because gas on Arc is USDC itself.
 *
 * Called by: arc/arcFacilitator.ts (verify + settle), arc/refundArc.ts
 * Tables touched: none
 * Env: X402_ARC_KEY (operations key, held by the operator), and the RPC URL
 *      resolved by config.getArcRpcUrl
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Account,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { getArcRpcUrl } from "@/lib/x402/config";
import type { NetworkConfig } from "@/lib/x402/networks";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 32-byte hex private key, 0x prefix optional. Mirrors celo/refundCelo.ts. */
const PRIVATE_KEY_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/;

/** 20-byte hex EVM address. */
export const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * Arc mainnet. Chain id, RPC and explorer read from
 * docs.arc.io/arc/references/rpc-endpoints and confirmed against the live
 * endpoint (eth_chainId returned 0x13b2 on 2026-09-17).
 *
 * nativeCurrency is USDC at 18 decimals on purpose: Arc exposes one asset
 * through two interfaces, the native gas balance at 18 decimals and the
 * ERC-20 at 6. Mixing the two scales is the classic Arc bug, so the token
 * side always goes through NetworkConfig.usdcDecimals instead of this field.
 */
export const ARC_CHAIN = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.arc.io" },
  },
});

// ---------------------------------------------------------------------------
// Operations account
// ---------------------------------------------------------------------------

export type ArcOperationsAccountResult =
  | { ok: true; account: Account }
  | { ok: false; message: string };

/**
 * The locally held key that signs every Arc settlement and refund.
 *
 * Errors as values rather than a throw: both callers already map failures to
 * a facilitator error, and a missing key must not take down an unrelated
 * network's request path. The key itself is never logged, only whether it is
 * absent or malformed.
 */
export function loadArcOperationsAccount(): ArcOperationsAccountResult {
  const operationsKey = process.env.X402_ARC_KEY;
  if (!operationsKey) {
    return {
      ok: false,
      message:
        "X402_ARC_KEY env var not set. Sharetopus settles Arc payments itself and cannot sign without it.",
    };
  }
  if (!PRIVATE_KEY_PATTERN.test(operationsKey)) {
    return {
      ok: false,
      message: "X402_ARC_KEY is not a 32-byte hex key.",
    };
  }
  const normalizedKey = (
    operationsKey.startsWith("0x") ? operationsKey : `0x${operationsKey}`
  ) as `0x${string}`;
  return { ok: true, account: privateKeyToAccount(normalizedKey) };
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

/** Read-only client for balance, nonce and receipt queries on Arc. */
export function createArcPublicClient(network: NetworkConfig): PublicClient {
  return createPublicClient({
    chain: ARC_CHAIN,
    transport: http(getArcRpcUrl(network)),
  });
}

/** Signing client for the operations wallet. */
export function createArcWalletClient(
  network: NetworkConfig,
  account: Account,
): WalletClient {
  return createWalletClient({
    account,
    chain: ARC_CHAIN,
    transport: http(getArcRpcUrl(network)),
  });
}
