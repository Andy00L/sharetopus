import "server-only";

import { randomBytes, createHash } from "node:crypto";

/**
 * Generates a new MCP API key and its SHA-256 hash.
 *
 * Keys follow the format `stp_mcp_<32 random hex chars>`.
 * We store only the hash in `api_keys.token_hash`. The raw key is shown
 * to the user exactly once at creation time.
 *
 * The 8-char prefix (`stp_mcp_` + first 8 of the hex) goes into
 * `api_keys.prefix` so we can display a recognizable stub in the UI
 * without exposing the full token.
 *
 * Called by: src/actions/server/mcp/createApiKey.ts
 * Tables touched: none directly (caller writes to api_keys)
 */
export function generateMcpApiKey(): {
  rawKey: string;
  prefix: string;
  tokenHash: string;
} {
  const hex = randomBytes(32).toString("hex");
  const rawKey = `stp_mcp_${hex}`;
  const prefix = `stp_mcp_${hex.slice(0, 8)}`;
  const tokenHash = hashToken(rawKey);
  return { rawKey, prefix, tokenHash };
}

/**
 * SHA-256 hashes a raw API key string.
 *
 * Used both at creation (to store the hash) and at lookup (to match
 * an incoming bearer token against `api_keys.token_hash`).
 */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Returns true if the token string looks like an MCP API key.
 * Just a prefix check, does not validate the key against the database.
 */
export function isMcpApiKeyToken(token: string): boolean {
  return token.startsWith("stp_mcp_");
}
