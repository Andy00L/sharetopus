/**
 * Explorer links for the Solana lane. One place, so the proof page and any
 * future surface point at the same explorer. The demo client
 * (demo/x402-demo.mjs) carries the same template because it is a separate
 * package that cannot import from src/.
 *
 * Pure URL builders, no secrets, safe to import from any component.
 */

const SOLANA_EXPLORER_BASE_URL = "https://explorer.solana.com";

export function buildSolanaExplorerTxUrl(signature: string): string {
  return `${SOLANA_EXPLORER_BASE_URL}/tx/${encodeURIComponent(signature)}`;
}

export function buildSolanaExplorerAddressUrl(address: string): string {
  return `${SOLANA_EXPLORER_BASE_URL}/address/${encodeURIComponent(address)}`;
}
