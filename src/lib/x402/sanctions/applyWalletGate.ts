import "server-only";

/**
 * Pre-call sanctions check for x402 wallet callers.
 *
 * Every x402 endpoint runs this before doing any platform work. Reads
 * wallets.sanctions_status; rejects "sanctioned", accepts "clean" and
 * "unchecked". Re-screening on every Nth call happens in Phase 4.1;
 * this gate is the read-only check.
 *
 * Called by: every x402 route handler (Phase 4.1+)
 * Tables touched: wallets (read only)
 */

import { adminSupabase } from "@/actions/api/adminSupabase";

export type WalletGateResult =
  | { allowed: true; sanctionsStatus: "clean" | "unchecked" }
  | { allowed: false; reason: "sanctioned" | "wallet_not_found" | "db_error"; message: string };

/**
 * Checks the wallets row for a sanctions block before allowing a paid action.
 *
 * Called by every x402 route handler immediately after resolveWalletPrincipal
 * succeeds and before any platform action (post, connect, schedule).
 *
 * Behavior:
 *   sanctions_status = "sanctioned"  -> denied
 *   sanctions_status = "clean"       -> allowed
 *   sanctions_status = "unchecked"   -> allowed (initial registration path)
 *   wallet row missing               -> denied (should not happen post-register)
 *   DB read error                    -> denied (fail-closed)
 *
 * Future hooks: Phase 4.5 will trigger a re-screen via Coinbase KYT or
 * a third-party Chainalysis API on the Nth call per month. Not in scope here.
 */
export async function applyWalletGate(walletId: string): Promise<WalletGateResult> {
  try {
    const { data, error } = await adminSupabase
      .from("wallets")
      .select("sanctions_status")
      .eq("id", walletId)
      .maybeSingle();

    if (error) {
      console.error(`[applyWalletGate] DB read failed for wallet ${walletId}: ${error.message}`);
      return {
        allowed: false,
        reason: "db_error",
        message: "Failed to check sanctions status. Try again later.",
      };
    }

    if (!data) {
      console.warn(`[applyWalletGate] Wallet not found: ${walletId}`);
      return {
        allowed: false,
        reason: "wallet_not_found",
        message: "Wallet not registered. Call /api/x402/register first.",
      };
    }

    const status = data.sanctions_status;

    if (status === "sanctioned") {
      console.warn(`[applyWalletGate] Sanctioned wallet denied: ${walletId}`);
      return {
        allowed: false,
        reason: "sanctioned",
        message: "This wallet has been flagged by sanctions screening and cannot transact.",
      };
    }

    // "clean" and "unchecked" are both allowed
    return {
      allowed: true,
      sanctionsStatus: status as "clean" | "unchecked",
    };
  } catch (err) {
    console.error(`[applyWalletGate] Unexpected error for wallet ${walletId}:`, err instanceof Error ? err.message : err);
    return {
      allowed: false,
      reason: "db_error",
      message: "Sanctions check failed unexpectedly. Try again later.",
    };
  }
}
