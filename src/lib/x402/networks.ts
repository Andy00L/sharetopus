import "server-only";

import type { WalletChain } from "@/db/schema";
import { USDC_DECIMALS } from "@/lib/x402/usdcAmount";

export type SettlementLane = "coinbase_cdp" | "celo" | "arc_local";

export type RecipientEnvVar =
  | "X402_RECIPIENT_EVM"
  | "X402_RECIPIENT_SOLANA"
  | "X402_RECIPIENT_CELO"
  | "X402_RECIPIENT_ARC";

export type RpcUrlEnvVar = "X402_ARC_RPC_URL" | "X402_SOLANA_RPC_URL";

interface NetworkConfigBase {
  name: WalletChain;
  caipNetwork: `${string}:${string}`;
  displayName: string;
  rpcUrl: string;
  rpcUrlEnvVar: RpcUrlEnvVar | null;
  usdcAddress: string;
  usdcDecimals: number;
  settlement: SettlementLane;
  recipientEnvVar: RecipientEnvVar;
}

export interface EvmNetworkConfig extends NetworkConfigBase {
  family: "evm";
  chainId: number;
  usdcEip712: { name: string; version: string };
}

export interface SvmNetworkConfig extends NetworkConfigBase {
  family: "svm";
}

export type NetworkConfig = EvmNetworkConfig | SvmNetworkConfig;

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
    usdcDecimals: USDC_DECIMALS,
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
    usdcDecimals: USDC_DECIMALS,
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
    usdcDecimals: USDC_DECIMALS,
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
    usdcDecimals: USDC_DECIMALS,
    usdcEip712: { name: "USDC", version: "2" },
    settlement: "celo",
    recipientEnvVar: "X402_RECIPIENT_CELO",
  },
  arc: {
    name: "arc",
    family: "evm",
    chainId: 5042,
    caipNetwork: "eip155:5042",
    displayName: "Arc",
    rpcUrl: "https://rpc.mainnet.arc.io",
    rpcUrlEnvVar: "X402_ARC_RPC_URL",
    usdcAddress: "0x3600000000000000000000000000000000000000",
    usdcDecimals: USDC_DECIMALS,
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
    usdcDecimals: USDC_DECIMALS,
    settlement: "coinbase_cdp",
    recipientEnvVar: "X402_RECIPIENT_SOLANA",
  },
} satisfies Partial<Record<WalletChain, NetworkConfig>>);

export type SupportedNetworkName = keyof typeof NETWORKS;

/** Own-key check, so "constructor" or "__proto__" never resolve to a network. */
function isSupportedNetworkName(name: string): name is SupportedNetworkName {
  return Object.hasOwn(NETWORKS, name);
}

export function getNetworkConfig(name: string): NetworkConfig | null {
  return isSupportedNetworkName(name) ? NETWORKS[name] : null;
}

/** Address equality: case-insensitive on EVM, exact on Solana (base58). */
export function addressesMatch(network: NetworkConfig, left: string, right: string): boolean {
  return network.family === "evm" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

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
