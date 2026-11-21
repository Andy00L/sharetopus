import type { WalletChain } from "@/db/schema";

const EXPLORER_BASE_URL_BY_NETWORK: ReadonlyMap<string, string> = new Map(
  Object.entries({
    base: "https://basescan.org",
    polygon: "https://polygonscan.com",
    arbitrum: "https://arbiscan.io",
    celo: "https://celoscan.io",
    arc: "https://explorer.arc.io",
    solana: "https://explorer.solana.com",
  } satisfies Partial<Record<WalletChain, string>>),
);

const DISPLAY_NAME_BY_NETWORK: ReadonlyMap<string, string> = new Map(
  Object.entries({
    base: "Base",
    polygon: "Polygon",
    arbitrum: "Arbitrum",
    celo: "Celo",
    arc: "Arc",
    solana: "Solana",
  } satisfies Partial<Record<WalletChain, string>>),
);

export function networkDisplayName(networkName: string): string {
  return DISPLAY_NAME_BY_NETWORK.get(networkName) ?? networkName;
}

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

export function buildExplorerTxUrl(
  networkName: string,
  txHash: string,
): string | null {
  const baseUrl = EXPLORER_BASE_URL_BY_NETWORK.get(networkName);
  return baseUrl ? `${baseUrl}/tx/${encodeURIComponent(txHash)}` : null;
}

export function buildExplorerAddressUrl(
  networkName: string,
  address: string,
): string | null {
  const baseUrl = EXPLORER_BASE_URL_BY_NETWORK.get(networkName);
  return baseUrl ? `${baseUrl}/address/${encodeURIComponent(address)}` : null;
}
