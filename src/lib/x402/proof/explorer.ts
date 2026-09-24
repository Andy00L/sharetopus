/**
 * Block explorer links for the proof ledger, one builder per network. One
 * place, so every surface that shows a settlement points at the same
 * explorer. The demo client (demo/x402-demo.mjs) carries its own copy of
 * these templates because it is a separate package that cannot import from
 * src/.
 *
 * Pure URL builders, no secrets, safe to import from any component.
 */

import type { WalletChain } from "@/db/schema";

/**
 * Explorer roots and their path vocabulary. EVM explorers say /address and
 * /tx; Solana Explorer says /address and /tx as well but is a different
 * host per chain, so the mapping stays explicit rather than derived.
 * sourceRef: src/lib/x402/networks.ts for the network slugs.
 */
const EXPLORER_BASE_URL_BY_NETWORK: Partial<Record<WalletChain, string>> = {
  base: "https://basescan.org",
  polygon: "https://polygonscan.com",
  arbitrum: "https://arbiscan.io",
  celo: "https://celoscan.io",
  arc: "https://explorer.arc.io",
  solana: "https://explorer.solana.com",
};

/** Human label for a network, used in link titles and the ledger column. */
const DISPLAY_NAME_BY_NETWORK: Partial<Record<WalletChain, string>> = {
  base: "Base",
  polygon: "Polygon",
  arbitrum: "Arbitrum",
  celo: "Celo",
  arc: "Arc",
  solana: "Solana",
};

/** Falls back to the raw slug so an unmapped network still renders. */
export function networkDisplayName(networkName: string): string {
  return DISPLAY_NAME_BY_NETWORK[networkName as WalletChain] ?? networkName;
}

/**
 * Transaction link for a network the caller knows is in the registry above,
 * for the paths that must hand the agent a usable URL rather than decide
 * what to render when there is none. A network without an explorer is a
 * build-time omission here, not a runtime state, so the raw hash stands in
 * and the gap is logged instead of surfacing an empty string.
 */
export function buildKnownExplorerTxUrl(
  networkName: string,
  txHash: string,
): string {
  const explorerUrl = buildExplorerTxUrl(networkName, txHash);
  if (explorerUrl === null) {
    console.warn(
      `[buildKnownExplorerTxUrl] No explorer on file for network "${networkName}"; returning the bare transaction hash.`,
    );
    return txHash;
  }
  return explorerUrl;
}

/**
 * Transaction link, or null when the network has no explorer on file. A
 * null tells the caller to print the identifier as plain text rather than a
 * link that goes nowhere.
 */
export function buildExplorerTxUrl(
  networkName: string,
  txHash: string,
): string | null {
  const baseUrl = EXPLORER_BASE_URL_BY_NETWORK[networkName as WalletChain];
  return baseUrl ? `${baseUrl}/tx/${encodeURIComponent(txHash)}` : null;
}

/** Address link, same contract as buildExplorerTxUrl. */
export function buildExplorerAddressUrl(
  networkName: string,
  address: string,
): string | null {
  const baseUrl = EXPLORER_BASE_URL_BY_NETWORK[networkName as WalletChain];
  return baseUrl ? `${baseUrl}/address/${encodeURIComponent(address)}` : null;
}
