import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { WalletPrincipal } from "./types";

export type ResolveWalletPrincipalResult =
  | { ok: true; principal: WalletPrincipal }
  | { ok: false; reason: "not_found" | "db_error"; message: string };

/**
 * Look up a wallet by address. Returns the WalletPrincipal tagged union.
 *
 * Address matching is case-insensitive (EVM addresses are canonicalized
 * to lowercase before lookup).
 *
 * Called by Phase 4.2+ endpoints (connect, post). NOT called by Phase 4.1
 * register (the wallet does not exist at register time).
 */
export async function resolveWalletPrincipal(
  address: string
): Promise<ResolveWalletPrincipalResult> {
  try {
    const { data, error } = await adminSupabase
      .from("wallets")
      .select("id, address, chain, sanctions_status")
      .ilike("address", address.toLowerCase())
      .maybeSingle();

    if (error) {
      console.error(`[resolveWalletPrincipal] DB error looking up wallet: ${error.message}`);
      return {
        ok: false,
        reason: "db_error",
        message: "Failed to look up wallet.",
      };
    }

    if (!data) {
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
        principalId: data.id,
        walletId: data.id,
        address: data.address,
        chain: data.chain,
        sanctionsStatus: data.sanctions_status,
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
