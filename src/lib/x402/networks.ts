import "server-only";

/**
 * Network registry for the x402 payment protocol.
 *
 * Single source of truth for supported networks and for how each one
 * settles. Facilitator choice, payout wallet, RPC override and refund
 * sender are all read from the entry (settlement, recipientEnvVar,
 * rpcUrlEnvVar), so no other module compares network names to decide how
 * money moves.
 *
 * Called by: config.ts, facilitator.ts, facilitatorClient.ts,
 *            http/resolveRequestNetwork.ts, the /proof and /solana pages,
 *            solanaActions/*
 * Tables touched: none (pure configuration)
 */

import type { WalletChain } from "@/db/schema";

/**
 * Who verifies and settles payments on a network. Stored verbatim in
 * x402_charges.facilitator, so the values are the domain vocabulary:
 *   - coinbase_cdp: CDP hosted facilitator; refunds go out through the CDP SDK.
 *   - celo: Celo hosted facilitator (api.x402.celo.org); refunds are signed
 *     locally with X402_CELO_REFUND_KEY.
 *   - arc_local: Sharetopus verifies and settles in process
 *     (arc/arcFacilitator.ts) and signs refunds with X402_ARC_KEY. No third
 *     party screens the payer on this lane.
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

/**
 * Supported mainnet networks. Testnets are excluded on purpose: WalletChain
 * still lists them at the DB level, but any ?network value not found here is
 * rejected with 400 unsupported_network.
 *
 * Base, Polygon and Arbitrum USDC domains verified against @x402/evm
 * DEFAULT_STABLECOINS (v2.14.0).
 */
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
  // usdcAddress from docs.celo.org/build-on-celo/build-with-ai/x402; the
  // domain and decimals were read from the contract on Forno (2026-07-16):
  // name "USDC" (not Base's "USD Coin"), version "2", decimals 6. Celo has
  // its own payout wallet because refunds must come from a key the operator
  // holds, which the shared CDP EVM wallet is not.
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
  // chainId and rpcUrl from docs.arc.io/arc/references/rpc-endpoints
  // (eth_chainId -> 0x13b2). usdcAddress is the system contract from
  // docs.arc.io/arc/references/contract-addresses; its name, version and
  // decimals were read on mainnet (2026-09-17) and the EIP-712 domain
  // separator recomputed from them matches the contract's own. Gas on Arc is
  // USDC, so the operations wallet that settles here pays a fraction of a
  // cent per broadcast. Circle's hosted Facilitator Service also settles
  // Arc since September 2026 but needs a Circle API key in production; this
  // lane stays self-settled until one is configured.
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

/**
 * Own-key check. A plain index would also resolve inherited names such as
 * "constructor" or "__proto__" to Object.prototype members and hand them
 * back as a network.
 */
function isSupportedNetworkName(name: string): name is SupportedNetworkName {
  return Object.hasOwn(NETWORKS, name);
}

/** Look up a network by its ?network slug. Null for anything unsupported. */
export function getNetworkConfig(name: string): NetworkConfig | null {
  return isSupportedNetworkName(name) ? NETWORKS[name] : null;
}

/**
 * Address equality on a network. EVM addresses compare case-insensitively
 * (EIP-55 checksum casing); Solana base58 is case-sensitive.
 */
export function addressesMatch(network: NetworkConfig, left: string, right: string): boolean {
  return network.family === "evm" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** Every supported network, in registry order. */
export function listNetworks(): NetworkConfig[] {
  return Object.values(NETWORKS);
}

/**
 * The configured default network (X402_DEFAULT_NETWORK), falling back to
 * Base when the variable is missing or names an unsupported network.
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
  return NETWORKS.base;
}
