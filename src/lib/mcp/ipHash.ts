import { createHash } from "node:crypto";
import "server-only";

// Local-dev salt only; anyone with the source can reverse IPs hashed with it.
const DEV_FALLBACK_SALT = "sharetopus-mcp-dev-only-do-not-use-in-prod";

let warnedAboutDevFallback = false;

/**
 * SHA-256(ip:salt) truncated to 32 hex chars, so raw IPs never reach the
 * database. Throws in production when MCP_IP_HASH_SALT is unset: a known
 * salt would store reversible IPs. Null for an empty input.
 */
export function hashClientIp(ip: string | null | undefined): string | null {
  if (!ip) return null;

  const configuredSalt = process.env.MCP_IP_HASH_SALT;

  if (!configuredSalt) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[hashClientIp] MCP_IP_HASH_SALT is required in production. " +
          "Generate one with `openssl rand -base64 32` and set it in " +
          "Vercel env (production scope).",
      );
    }

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
