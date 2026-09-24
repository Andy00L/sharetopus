//rate-limit.ts
import "server-only";

import { redis } from "@/actions/api/upstash";
import { Ratelimit } from "@upstash/ratelimit";
import { headers } from "next/headers";

import { resolveClientIp } from "@/lib/net/clientIp";
import { timingSafeEqualSecret } from "@/lib/utils/timingSafeEqualSecret";

/**
 * Get the client IP address from request headers.
 * Returns null if the IP can't be determined.
 *
 * Delegates to the shared resolver so the rate-limit bucket key and the
 * audit-log IP hash can never disagree about who the caller is. The
 * resolver deliberately ignores the caller-supplied head of
 * x-forwarded-for; see lib/net/clientIp.ts.
 */
async function getIpAddress(): Promise<string | null> {
  return resolveClientIp(await headers());
}

/**
 * A refused check says why, with a message fit to show a person:
 *   - "limited": the caller hit the limit. resetIn is the wait in seconds.
 *   - "unidentified": there was no user id or IP to key the limit on.
 *   - "unavailable": the limiter itself failed (Redis unreachable). The
 *     caller did nothing wrong, so no surface may answer it with 429 or
 *     "too many requests".
 * Callers pass message on instead of writing their own, which is how an
 * outage stays an outage all the way to the person or agent.
 */
export type RateLimitRefusal =
  | { success: false; reason: "limited"; message: string; resetIn: number }
  | {
      success: false;
      reason: "unidentified" | "unavailable";
      message: string;
      resetIn?: never;
    };

export type RateLimitCheck = { success: true } | RateLimitRefusal;

/**
 * Apply rate limiting to any operation
 *
 * @param operationName - Name of operation (e.g., 'fetchData', 'submitForm')
 * @param userId - Optional user ID for rate limiting (overrides IP-based limiting)
 * @param limit - Number of requests allowed (default: 20)
 * @param window - Time window in seconds (default: 60)
 * @param bypassSecret - Optional secret to bypass rate limiting (for internal/cron use)
 * @returns { success: true }, or a RateLimitRefusal naming the reason.
 */
export async function checkRateLimit(
  operationName: string,
  userId?: string | null,
  limit: number = 20,
  window: number = 60,
  bypassSecret?: string | undefined
): Promise<RateLimitCheck> {
  try {
    // Check for valid bypass secret. Compared in constant time: a plain
    // === leaks the shared cron secret's prefix through response timing.
    const validBypassSecret = process.env.CRON_SECRET_KEY;
    if (
      bypassSecret &&
      validBypassSecret &&
      timingSafeEqualSecret(bypassSecret, validBypassSecret)
    ) {
      console.log(
        `[checkRateLimit] Rate limiting bypassed for operation: ${operationName}`
      );
      return { success: true };
    }

    // Create a rate limiter for this operation
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${window} s`),
      analytics: true,
      prefix: `ratelimit_${operationName}`,
    });

    // Get identifier (userId or IP)
    const identifier = userId ?? (await getIpAddress());

    if (!identifier) {
      console.error(
        `[checkRateLimit] No identifier available for operation: ${operationName}`
      );

      return {
        success: false,
        message: "Unable to identify client for rate limiting",
        reason: "unidentified",
      };
    }

    // Apply rate limiting
    const { success, reset } = await limiter.limit(identifier);

    if (success) {
      return {
        success: true,
      };
    }

    // Retry-After takes a whole number of seconds that is not negative (RFC
    // 9110 section 10.2.3). A window that reset between the check and this
    // line would give 0 or less, so the wait is at least 1 s.
    const resetInSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    console.warn(
      `[checkRateLimit] Rate limit exceeded for operation: ${operationName}, reset in: ${resetInSeconds}s`
    );

    return {
      success: false,
      message: "Rate limit exceeded. Please try again later.",
      resetIn: resetInSeconds,
      reason: "limited",
    };
  } catch (error) {
    console.error(
      `[checkRateLimit] Rate limit check failed for operation: ${operationName}`,
      error instanceof Error ? error.message : error
    );

    return {
      success: false,
      message: "Could not check the rate limit. Please try again.",
      reason: "unavailable",
    };
  }
}
