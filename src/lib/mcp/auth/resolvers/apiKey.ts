import "server-only";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { extractIpHash } from "@/lib/mcp/context";
import { hashToken } from "@/lib/mcp/tokens";
import type { McpPrincipal } from "../types";

/**
 * Resolves a `stp_mcp_` API key token to a principal.
 *
 * Returns null if key is unknown, revoked, expired, or principal missing.
 * Updates `last_used_at` on success.
 *
 * Source: extracted from src/lib/mcp/auth.ts:147-192.
 */
export async function resolveApiKey(
  rawToken: string
): Promise<McpPrincipal | null> {
  const hash = hashToken(rawToken);

  const { data: key, error } = await adminSupabase
    .from("api_keys")
    .select("id, principal_id, kind, scopes, revoked_at, expires_at")
    .eq("token_hash", hash)
    .eq("kind", "mcp")
    .is("revoked_at", null)
    .single();

  if (error || !key) return null;

  // Check expiration
  if (key.expires_at && new Date(key.expires_at) < new Date()) {
    return null;
  }

  // Verify the principal is a Clerk user (the trigger enforces this,
  // but belt-and-suspenders)
  const { data: principal } = await adminSupabase
    .from("principals")
    .select("id, kind")
    .eq("id", key.principal_id)
    .eq("kind", "clerk")
    .single();

  if (!principal) return null;

  // Update last_used_at. Awaited so it lands before the serverless
  // function freezes. (@vercel/functions is not installed, so we
  // cannot use waitUntil here.)
  const ipHash = await extractIpHash();
  await adminSupabase
    .from("api_keys")
    .update({
      last_used_at: new Date().toISOString(),
      last_used_ip: ipHash,
    })
    .eq("id", key.id);

  return {
    kind: "apikey",
    principalId: key.principal_id,
    apiKeyId: key.id,
    scopes: key.scopes ?? [],
    plan: "free",
    priceId: null,
  };
}
