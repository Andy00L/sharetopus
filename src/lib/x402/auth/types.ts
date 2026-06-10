import "server-only";

/**
 * Wallet principal type for the x402 namespace.
 *
 * Separate from McpPrincipal (src/lib/mcp/auth/types.ts) because x402 has no
 * plan tier, no scopes, no API key. Wallets pay per-call via x402_charges.
 *
 * Called by: resolveWalletPrincipal, applyWalletGate, logX402Call, routes
 * Tables touched: none (type definitions only)
 */

import type { WalletChain, SanctionsStatus } from "@/lib/types/database.types";

/**
 * Identity for an x402 wallet caller. Created during register, attached to
 * every subsequent request by resolveWalletPrincipal (Phase 4.1).
 *
 * Unlike McpPrincipal, wallets have no plan tier, no scopes, no API key id.
 * Pricing is per-call via x402_charges. Authorization is per-call via
 * applyWalletGate (sanctions check).
 */
export interface WalletPrincipal {
  /** Discriminator. Always "wallet" for this type. */
  kind: "wallet";

  /** principals.id (also wallets.id, since wallets.id FKs principals.id). */
  principalId: string;

  /** wallets.id (same value as principalId; aliased for code clarity). */
  walletId: string;

  /** Lowercase wallet address (EVM) or Solana pubkey (base58). */
  address: string;

  /** Network family this wallet registered on. */
  chain: WalletChain;

  /** Latest sanctions screening result. Updated on every charge. */
  sanctionsStatus: SanctionsStatus;
}
