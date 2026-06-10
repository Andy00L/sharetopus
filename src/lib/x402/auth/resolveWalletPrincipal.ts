import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { WalletPrincipal } from "./types";

export type ResolveWalletPrincipalResult =
  | { ok: true; principal: WalletPrincipal }
  | { ok: false; reason: "not_found" | "db_error"; message: string };

/**
 * Look up a wallet by address. Returns the WalletPrincipal tagged union.
 *
 * Matching is exact equality, never ILIKE: pattern matching on an
 * attacker-supplied address would let % and _ act as SQL wildcards. EVM
 * addresses (0x-prefixed, case-insensitive by spec) are stored lowercase at
 * registration, so the lookup lowercases those; Solana base58 addresses are
 * case-sensitive and compared verbatim.
 *
 * Called by: x402PaidEndpoint, handleConnectVerify.
 * Tables touched: wallets (read)
 */
export async function resolveWalletPrincipal(
  address: string
): Promise<ResolveWalletPrincipalResult> {
  const normalizedAddress = address.startsWith("0x")
    ? address.toLowerCase()
    : address;

  try {
    const { data: wallet, error } = await adminSupabase
      .from("wallets")
      .select("id, address, chain, sanctions_status")
      .eq("address", normalizedAddress)
      .maybeSingle();

    if (error) {
      console.error(`[resolveWalletPrincipal] DB error looking up wallet: ${error.message}`);
      return {
        ok: false,
        reason: "db_error",
        message: "Failed to look up wallet.",
      };
    }

    if (!wallet) {
      return {
        ok: false,
        reason: "not_found",
        message: "Wallet not registered. Call /api/x402/register first.",
      };
    }

    return {
      ok: true,
      principal: {
        kind: "wallet",
        principalId: wallet.id,
        walletId: wallet.id,
        address: wallet.address,
        chain: wallet.chain,
        sanctionsStatus: wallet.sanctions_status,
      },
    };
  } catch (err) {
    console.error("[resolveWalletPrincipal] Unexpected error:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      reason: "db_error",
      message: "Unexpected error resolving wallet principal.",
    };
  }
}
