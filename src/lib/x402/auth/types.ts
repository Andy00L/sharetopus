import "server-only";

/**
 * Wallet principal type and exhaustive-check helper for x402 namespace.
 *
 * Separate from McpPrincipal (src/lib/mcp/auth/types.ts) because x402 has no
 * plan tier, no scopes, no API key. Wallets pay per-call via x402_charges.
 *
 * Called by: resolveWalletPrincipal (Phase 4.1), applyWalletGate, logX402Call
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

/**
 * Exhaustive type-narrowing helper. Place at the bottom of any switch on
 * principal.kind to force TS to error if a new variant is added without
 * being handled.
 *
 * If you ever introduce a second principal kind in the x402 namespace (e.g.,
 * delegate wallets, shared wallets), TS will fail to compile every switch
 * until the new kind is added.
 *
 * Mirror of src/lib/mcp/auth/types.ts assertExhaustiveKind.
 */
export function assertExhaustiveWalletKind(value: never): never {
  throw new Error(
    `[assertExhaustiveWalletKind] Unhandled WalletPrincipal variant: ${JSON.stringify(value)}`
  );
}
