import "server-only";

import { generateSiweNonce } from "viem/siwe";
import { adminSupabase } from "@/actions/api/adminSupabase";

/** 5 minutes, per Drew decision #11. */
const SIWE_NONCE_TTL_SECONDS = 300;

export type CreateSiweNonceResult =
  | { ok: true; nonce: string; expiresAt: string }
  | { ok: false; error: "db_error"; message: string };

/**
 * Generates a fresh SIWE nonce using viem/siwe generateSiweNonce (96-bit
 * entropy) and inserts a row in siwe_nonces with a 5-minute expiry.
 *
 * Called by handleRegisterChallenge before returning the 402 response.
 * The nonce is included in the response body so the agent knows what to sign.
 */
export async function createSiweNonce(): Promise<CreateSiweNonceResult> {
  const nonce = generateSiweNonce();
  const expiresAt = new Date(
    Date.now() + SIWE_NONCE_TTL_SECONDS * 1000
  ).toISOString();

  const { error } = await adminSupabase.from("siwe_nonces").insert({
    nonce,
    expires_at: expiresAt,
    used_at: null,
    wallet: null,
  });

  if (error) {
    console.error(`[createSiweNonce] Failed to insert nonce: ${error.message}`);
    return { ok: false, error: "db_error", message: error.message };
  }

  return { ok: true, nonce, expiresAt };
}
