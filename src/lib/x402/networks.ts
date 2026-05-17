import "server-only";

/**
 * Network registry for x402 payment protocol.
 *
 * Single source of truth for supported networks. Every x402 endpoint and the
 * facilitator wrapper read from here. No magic strings elsewhere.
 *
 * Called by: facilitator.ts, route handlers (Phase 4.1+)
 * Tables touched: none (pure configuration)
 *
 * USDC contract addresses verified against @x402/evm v2.11.0 source
 * (node_modules/@x402/evm/dist/cjs/exact/server/index.js).
 * Coinbase doc URL (docs.cdp.coinbase.com/x402/networks-and-tokens/usdc-addresses)
 * returned 404 at build time; addresses confirmed via the SDK package instead.
 */

import type { WalletChain } from "@/lib/types/database.types";

export interface NetworkConfig {
  /** Network slug used by x402 protocol (matches WalletChain in database.types.ts). */
  name: WalletChain;

  /** EVM chain ID, or null for non-EVM (Solana). */
  chainId: number | null;

  /**
   * CAIP-2 network identifier used by @x402/core.
   * Format: "eip155:{chainId}" for EVM, "solana:{genesisHashPrefix}" for Solana.
   *
   * Divergence from prompt spec: @x402/core defines Network as `${string}:${string}`
   * (CAIP format), not as WalletChain. This field bridges the two representations.
   */
  caipNetwork: string;

  /** Human-readable display name shown in errors and logs. */
  displayName: string;

  /** Public RPC URL used for read-only queries (balance checks, block lookups). */
  rpcUrl: string;

  /** USDC token contract address on this network. Mint address on Solana. */
  usdcAddress: string;

  /**
   * Retained for interface compatibility. All entries in NETWORKS are mainnet
   * (isTestnet = false). Testnet entries were removed from the registry;
   * WalletChain still includes those values at the DB schema level.
   */
  isTestnet: boolean;

  /** True for EVM chains, false for Solana. Used by facilitator dispatch. */
  isEvm: boolean;

  /**
   * USDC has 6 decimals on every supported network today (Circle policy).
   * Hardcoded constant for safety; if a network ever ships a wrapped USDC with
   * different decimals, override here.
   */
  usdcDecimals: number;
}

/**
 * Frozen registry of supported mainnet networks. Read-only at runtime.
 *
 * Testnet entries (base-sepolia, solana-devnet) intentionally excluded.
 * WalletChain still includes those values at the DB schema level; blocking
 * is app-layer only. Agents requesting a testnet network via getNetworkConfig()
 * will receive null, causing the middleware to reject with unsupported_network.
 */
export const NETWORKS: Readonly<Partial<Record<WalletChain, NetworkConfig>>> =
  Object.freeze({
    base: {
      name: "base",
      chainId: 8453,
      caipNetwork: "eip155:8453",
      displayName: "Base",
      rpcUrl: "https://mainnet.base.org",
      usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      isTestnet: false,
      isEvm: true,
      usdcDecimals: 6,
    },
    polygon: {
      name: "polygon",
      chainId: 137,
      caipNetwork: "eip155:137",
      displayName: "Polygon",
      rpcUrl: "https://polygon-rpc.com",
      usdcAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      isTestnet: false,
      isEvm: true,
      usdcDecimals: 6,
    },
    arbitrum: {
      name: "arbitrum",
      chainId: 42161,
      caipNetwork: "eip155:42161",
      displayName: "Arbitrum",
      rpcUrl: "https://arb1.arbitrum.io/rpc",
      usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      isTestnet: false,
      isEvm: true,
      usdcDecimals: 6,
    },
    solana: {
      name: "solana",
      chainId: null,
      caipNetwork: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      displayName: "Solana",
      rpcUrl: "https://api.mainnet-beta.solana.com",
      usdcAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      isTestnet: false,
      isEvm: false,
      usdcDecimals: 6,
    },
  });

// Module-load assertion: mainnet "base" entry must exist. This runs at process
// startup, not per-request. Failure here is a build-time configuration error.
if (!NETWORKS.base) {
  throw new Error(
    "[networks.ts] Mainnet 'base' entry missing from NETWORKS. This is a build-time configuration error."
  );
}
const baseConfig: NetworkConfig = NETWORKS.base;

/**
 * Look up a network by name. Returns null for unknown names.
 *
 * Used by route handlers to validate the network field on incoming X-PAYMENT
 * headers. Never trust user input; always go through this function.
 */
export function getNetworkConfig(name: string): NetworkConfig | null {
  return (NETWORKS as Record<string, NetworkConfig>)[name] ?? null;
}

/**
 * The configured default mainnet network (reads X402_DEFAULT_NETWORK env).
 * Falls back to "base" if the env var is missing or invalid.
 */
export function getDefaultNetwork(): NetworkConfig {
  const envName = process.env.X402_DEFAULT_NETWORK;
  if (envName) {
    const config = getNetworkConfig(envName);
    if (config) return config;
    console.warn(
      `[getDefaultNetwork] X402_DEFAULT_NETWORK="${envName}" is not a known network. Falling back to "base".`,
    );
  }
  // baseConfig is asserted non-null at module load above.
  return baseConfig;
}

/** Type guard: true if the given network is EVM-based. */
export function isEvmNetwork(network: NetworkConfig): boolean {
  return network.isEvm;
}
