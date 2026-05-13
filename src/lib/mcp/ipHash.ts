import { createHash } from "node:crypto";
import "server-only";

/**
 * Dev-only fallback salt. Used ONLY when NODE_ENV !== "production"
 * and MCP_IP_HASH_SALT is unset (local dev convenience). In production,
 * a missing env var throws — see hashClientIp() below.
 *
 * Never rely on this salt for any real anonymization. Anyone with the
 * source tree can reverse-hash IPs that were hashed with this value.
 */
const DEV_FALLBACK_SALT = "sharetopus-mcp-dev-only-do-not-use-in-prod";

/**
 * One-shot guard so the dev fallback warning fires once per process,
 * not once per request. Reset to false on cold start.
 */
let warnedAboutDevFallback = false;

/**
 * Hashes a client IP address with a process-wide salt so raw IPs
 * never reach the database.
 *
 * Behavior:
 *   - null or empty input → returns null (caller passes through "unknown IP")
 *   - MCP_IP_HASH_SALT set → use it (production-safe path)
 *   - MCP_IP_HASH_SALT unset + production → THROW (fail fast at request time)
 *   - MCP_IP_HASH_SALT unset + dev → log once, use DEV_FALLBACK_SALT
 *
 * The hash is SHA-256(ip + ":" + salt) truncated to 32 hex chars (16 bytes
 * of entropy). Truncation is acceptable because we only need collision
 * resistance, not preimage resistance — the salt is the secret.
 *
 * Setting the salt:
 *   openssl rand -base64 32
 *   vercel env add MCP_IP_HASH_SALT production
 *
 * Called by: src/lib/mcp/context.ts (extractIpHash)
 */
export function hashClientIp(ip: string | null | undefined): string | null {
  if (!ip) return null;

  const configuredSalt = process.env.MCP_IP_HASH_SALT;

  if (!configuredSalt) {
    // Production: hard-fail. A missing salt means we'd write
    // reverse-hashable IPs to mcp_audit_log, which defeats the whole
    // point of the column being a hash. Better to break the request
    // than silently leak PII.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[hashClientIp] MCP_IP_HASH_SALT is required in production. " +
          "Generate one with `openssl rand -base64 32` and set it in " +
          "Vercel env (production scope).",
      );
    }

    // Dev/test: warn once, continue with the dev fallback so local
    // workflows are not blocked. The fallback is intentionally weak
    // so anyone forgetting to set the env in prod sees the throw above.
    if (!warnedAboutDevFallback) {
      console.warn(
        "[hashClientIp] MCP_IP_HASH_SALT not set; using DEV fallback. " +
          "Set MCP_IP_HASH_SALT in .env.local for parity with prod.",
      );
      warnedAboutDevFallback = true;
    }
  }

  const resolvedSalt = configuredSalt ?? DEV_FALLBACK_SALT;

  return createHash("sha256")
    .update(ip + ":" + resolvedSalt)
    .digest("hex")
    .slice(0, 32);
}
