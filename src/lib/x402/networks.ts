import "server-only";

// x402 network registry: the one place that decides how each network settles,
// pays out and refunds. No other module compares network names.

import type { WalletChain } from "@/db/schema";

/**
 * Who settles a network, stored in x402_charges.facilitator: CDP (refunds via
 * the CDP SDK), Celo's facilitator (refunds signed with X402_CELO_REFUND_KEY),
 * or Sharetopus itself on Arc (refunds signed with X402_ARC_KEY).
 */
export type SettlementLane = "coinbase_cdp" | "celo" | "arc_local";

/** Env var holding the payout (payTo) address, which also sends refunds. */
export type RecipientEnvVar =
  | "X402_RECIPIENT_EVM"
  | "X402_RECIPIENT_SOLANA"
  | "X402_RECIPIENT_CELO"
  | "X402_RECIPIENT_ARC";

/** Env var that may point a network at a dedicated RPC provider. */
export type RpcUrlEnvVar = "X402_ARC_RPC_URL" | "X402_SOLANA_RPC_URL";

interface NetworkConfigBase {
  /** Slug used in ?network= and stored in DB rows (matches WalletChain). */
  name: WalletChain;
  /** CAIP-2 identifier the x402 wire protocol uses ("eip155:8453"). */
  caipNetwork: `${string}:${string}`;
  /** Human-readable name for errors and logs. */
  displayName: string;
  /** Public RPC endpoint, used when no override is configured. */
  rpcUrl: string;
  /** Optional dedicated RPC override (config.getRpcUrl), null when none. */
  rpcUrlEnvVar: RpcUrlEnvVar | null;
  /** USDC contract (EVM) or mint (Solana). */
  usdcAddress: string;
  /** USDC decimals: 6 on every supported network (Circle policy). */
  usdcDecimals: number;
  settlement: SettlementLane;
  recipientEnvVar: RecipientEnvVar;
}

/** EVM network: exact-scheme clients sign EIP-3009 over usdcEip712. */
export interface EvmNetworkConfig extends NetworkConfigBase {
  family: "evm";
  chainId: number;
  /**
   * EIP-712 domain of the USDC contract, carried in PaymentRequirements.extra
   * (the official @x402/evm client refuses to sign without name/version).
   */
  usdcEip712: { name: string; version: string };
}

/** Solana network: the facilitator co-signs as fee payer (extra.feePayer). */
export interface SvmNetworkConfig extends NetworkConfigBase {
  family: "svm";
}

export type NetworkConfig = EvmNetworkConfig | SvmNetworkConfig;

/** Supported mainnets; any other ?network value gets 400 unsupported_network. */
export const NETWORKS = Object.freeze({
  base: {
    name: "base",
    family: "evm",
    chainId: 8453,
    caipNetwork: "eip155:8453",
    displayName: "Base",
    rpcUrl: "https://mainnet.base.org",
    rpcUrlEnvVar: null,
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    usdcDecimals: 6,
    usdcEip712: { name: "USD Coin", version: "2" },
    settlement: "coinbase_cdp",
    recipientEnvVar: "X402_RECIPIENT_EVM",
  },
  polygon: {
    name: "polygon",
    family: "evm",
    chainId: 137,
    caipNetwork: "eip155:137",
    displayName: "Polygon",
    rpcUrl: "https://polygon-rpc.com",
    rpcUrlEnvVar: null,
    usdcAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    usdcDecimals: 6,
    usdcEip712: { name: "USD Coin", version: "2" },
    settlement: "coinbase_cdp",
    recipientEnvVar: "X402_RECIPIENT_EVM",
  },
  arbitrum: {
    name: "arbitrum",
    family: "evm",
    chainId: 42161,
    caipNetwork: "eip155:42161",
    displayName: "Arbitrum",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    rpcUrlEnvVar: null,
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    usdcDecimals: 6,
    usdcEip712: { name: "USD Coin", version: "2" },
    settlement: "coinbase_cdp",
    recipientEnvVar: "X402_RECIPIENT_EVM",
  },
  // EIP-712 name is "USDC" here, not "USD Coin" (read on-chain 2026-07-16).
  celo: {
    name: "celo",
    family: "evm",
    chainId: 42220,
    caipNetwork: "eip155:42220",
    displayName: "Celo",
    rpcUrl: "https://forno.celo.org",
    rpcUrlEnvVar: null,
    usdcAddress: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    usdcDecimals: 6,
    usdcEip712: { name: "USDC", version: "2" },
    settlement: "celo",
    recipientEnvVar: "X402_RECIPIENT_CELO",
  },
  // Gas on Arc is USDC; the settling operations wallet pays it (docs.arc.io).
  arc: {
    name: "arc",
    family: "evm",
    chainId: 5042,
    caipNetwork: "eip155:5042",
    displayName: "Arc",
    rpcUrl: "https://rpc.mainnet.arc.io",
    rpcUrlEnvVar: "X402_ARC_RPC_URL",
    usdcAddress: "0x3600000000000000000000000000000000000000",
    usdcDecimals: 6,
    usdcEip712: { name: "USDC", version: "2" },
    settlement: "arc_local",
    recipientEnvVar: "X402_RECIPIENT_ARC",
  },
  solana: {
    name: "solana",
    family: "svm",
    caipNetwork: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    displayName: "Solana",
    rpcUrl: "https://api.mainnet-beta.solana.com",
    rpcUrlEnvVar: "X402_SOLANA_RPC_URL",
    usdcAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    usdcDecimals: 6,
    settlement: "coinbase_cdp",
    recipientEnvVar: "X402_RECIPIENT_SOLANA",
  },
} satisfies Partial<Record<WalletChain, NetworkConfig>>);

export type SupportedNetworkName = keyof typeof NETWORKS;

/** Own-key check, so "constructor" or "__proto__" never resolve to a network. */
function isSupportedNetworkName(name: string): name is SupportedNetworkName {
  return Object.hasOwn(NETWORKS, name);
}

/** Look up a network by its ?network slug. Null for anything unsupported. */
export function getNetworkConfig(name: string): NetworkConfig | null {
  return isSupportedNetworkName(name) ? NETWORKS[name] : null;
}

/** Address equality: case-insensitive on EVM, exact on Solana (base58). */
export function addressesMatch(network: NetworkConfig, left: string, right: string): boolean {
  return network.family === "evm" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** X402_DEFAULT_NETWORK, or Base when it is unset or unknown. */
export function getDefaultNetwork(): NetworkConfig {
  const envName = process.env.X402_DEFAULT_NETWORK;
  if (envName) {
    const config = getNetworkConfig(envName);
    if (config) return config;
    console.warn(
      `[getDefaultNetwork] X402_DEFAULT_NETWORK="${envName}" is not a known network. Falling back to "base".`,
    );
  }
  return NETWORKS.base;
}
