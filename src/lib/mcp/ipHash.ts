import "server-only";
import { createHash } from "crypto";

const FALLBACK_SALT = "sharetopus-mcp-ip-hash-fallback-do-not-rely-on-this";
let warnedAboutFallback = false;

/**
 * Hashes a client IP address with a salt so raw IPs never reach the DB.
 *
 * Returns null when the input is null/empty so callers can pass through
 * "unknown IP" cases unchanged.
 *
 * If MCP_IP_HASH_SALT is not set in production, falls back to a hardcoded
 * weak salt and logs a warning ONCE per process.
 */
export function hashClientIp(ip: string | null | undefined): string | null {
  if (!ip) return null;

  const salt = process.env.MCP_IP_HASH_SALT;
  if (!salt) {
    if (!warnedAboutFallback) {
      console.warn(
        "[hashClientIp] MCP_IP_HASH_SALT is not set. Using fallback salt. " +
          "Set MCP_IP_HASH_SALT to a 32-byte base64 string for proper anonymization."
      );
      warnedAboutFallback = true;
    }
  }

  const effectiveSalt = salt ?? FALLBACK_SALT;
  return createHash("sha256")
    .update(ip + ":" + effectiveSalt)
    .digest("hex")
    .slice(0, 32);
}
