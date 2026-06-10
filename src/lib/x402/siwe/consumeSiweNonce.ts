import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";

export type ConsumeSiweNonceResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "already_used" | "expired" | "db_error";
      message: string;
    };

/**
 * Marks a SIWE nonce as used. The UPDATE uses a WHERE clause that only
 * matches if used_at IS NULL AND expires_at > now(); the affected-row count
 * decides success, so two concurrent consumers can never both win. If 0
 * rows are updated, a follow-up SELECT distinguishes not_found vs
 * already_used vs expired.
 *
 * consumingWallet records which wallet burned the nonce (siwe_nonces.wallet
 * is null at issuance because the challenge is anonymous); it is audit
 * context, not an authorization input.
 *
 * Called by: handleRegisterVerify, handleRegisterSolanaVerify after SIWE
 * signature verification succeeds.
 */
export async function consumeSiweNonce(
  nonce: string,
  consumingWallet: string | null
): Promise<ConsumeSiweNonceResult> {
  const now = new Date().toISOString();

  // Atomic single-use: UPDATE only if unused and unexpired.
  const { data: consumedRows, error } = await adminSupabase
    .from("siwe_nonces")
    .update({ used_at: now, wallet: consumingWallet })
    .eq("nonce", nonce)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("nonce");

  if (error) {
    console.error(`[consumeSiweNonce] DB error consuming nonce: ${error.message}`);
    return { ok: false, reason: "db_error", message: error.message };
  }

  if (consumedRows && consumedRows.length > 0) {
    return { ok: true };
  }

  // Follow-up SELECT to determine why consumption failed.
  const { data: existing, error: selectError } = await adminSupabase
    .from("siwe_nonces")
    .select("nonce, used_at, expires_at")
    .eq("nonce", nonce)
    .maybeSingle();

  if (selectError) {
    console.error(`[consumeSiweNonce] DB error looking up nonce: ${selectError.message}`);
    return { ok: false, reason: "db_error", message: selectError.message };
  }

  if (!existing) {
    return {
      ok: false,
      reason: "not_found",
      message: "SIWE nonce does not exist.",
    };
  }

  if (existing.used_at) {
    return {
      ok: false,
      reason: "already_used",
      message: "SIWE nonce has already been used.",
    };
  }

  return {
    ok: false,
    reason: "expired",
    message: "SIWE nonce has expired.",
  };
}
