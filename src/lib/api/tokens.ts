import "server-only";

import { randomBytes, createHash } from "node:crypto";

/**
 * Supported API key kinds. Wallet is reserved for future x402 use.
 * The DB CHECK constraint on api_keys.kind enforces this set.
 */
export type ApiKeyKind = "mcp" | "rest";

const TOKEN_RANDOM_BYTES = 32;
const PREFIX_DISPLAY_LENGTH = 16;

/**
 * Generates a new API key for the given kind.
 *
 * Format: `stp_<kind>_<hex>` where <hex> is 64 hex chars (32 random bytes).
 *
 * Returns the raw key (shown to the user ONCE at creation time), a display
 * prefix (saved to api_keys.prefix for UI listing), and a sha256 hash
 * (saved to api_keys.token_hash for lookup during request validation).
 *
 * The raw key never leaves this function on a second call. Only the hash
 * is persistent.
 */
export function generateApiKey(kind: ApiKeyKind): {
  rawKey: string;
  prefix: string;
  tokenHash: string;
} {
  const randomHexSegment = randomBytes(TOKEN_RANDOM_BYTES).toString("hex");
  const rawKey = `stp_${kind}_${randomHexSegment}`;
  const prefix = rawKey.slice(0, `stp_${kind}_`.length + PREFIX_DISPLAY_LENGTH);
  const tokenHash = hashToken(rawKey);

  return { rawKey, prefix, tokenHash };
}

/**
 * Hashes a raw API key for storage and lookup. Uses sha256 (256 bits).
 *
 * We use a plain sha256 (no salt) because the key body itself is 256 bits
 * of cryptographic randomness, so rainbow-table attacks are infeasible.
 * If the random body were short or user-chosen, we would need a salt.
 */
export function hashToken(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Returns true iff the given token has the format produced by
 * generateApiKey(kind). Used by route handlers to dispatch the token
 * to the correct resolver path.
 *
 * Strict prefix match. Does NOT validate the random segment or check
 * the DB. That happens in the resolver.
 */
export function isApiKeyToken(token: string, kind: ApiKeyKind): boolean {
  return token.startsWith(`stp_${kind}_`);
}
