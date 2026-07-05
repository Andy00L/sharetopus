import { isPrivateOrReservedIp } from "@/lib/net/ipBlocklist";
import { lookup } from "node:dns/promises";

const MAX_URL_LENGTH = 2048;

/**
 * Result of webhook URL validation.
 */
export type VerifyWebhookUrlResult =
  | { valid: true }
  | { valid: false; message: string };

/**
 * Validates a webhook subscription URL.
 *
 * Rules:
 *   1. Must be HTTPS
 *   2. Max 2048 chars
 *   3. Must not resolve to private/reserved IP ranges (SSRF guard)
 *   4. Must not be localhost
 *
 * This is a create/update-time advisory check. The authoritative SSRF
 * guard runs at every delivery in deliverSignedWebhook, which re-resolves
 * and PINS the connection to the validated IP (rebinding defense). The
 * DNS failure here stays non-blocking on purpose: a host that does not
 * resolve from this environment but resolves at delivery is still safe,
 * because the delivery path validates and pins the resolved IP.
 *
 * Reuses isPrivateOrReservedIp from @/lib/net/ipBlocklist (single source
 * of truth for IP blocking).
 */
export async function verifyWebhookUrl(
  url: string,
): Promise<VerifyWebhookUrlResult> {
  if (url.length > MAX_URL_LENGTH) {
    return { valid: false, message: "URL must be 2048 characters or fewer" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, message: "Invalid URL format" };
  }

  if (parsed.protocol !== "https:") {
    return { valid: false, message: "URL must use HTTPS" };
  }

  const hostname = parsed.hostname;
  if (!hostname) {
    return { valid: false, message: "URL must have a hostname" };
  }

  // Block localhost variants.
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  ) {
    return { valid: false, message: "Localhost URLs are not allowed" };
  }

  // DNS lookup to check resolved IP is not private/reserved.
  try {
    const lookupResult = await lookup(hostname, { all: true });
    for (const resolved of lookupResult) {
      if (isPrivateOrReservedIp(resolved.address)) {
        return {
          valid: false,
          message: "URL resolves to a private or reserved IP address",
        };
      }
    }
  } catch {
    // DNS failure is not blocking: the URL might resolve at delivery
    // time from a different network (Vercel vs local dev). Allow it
    // and let the delivery worker handle connection failures.
  }

  return { valid: true };
}
