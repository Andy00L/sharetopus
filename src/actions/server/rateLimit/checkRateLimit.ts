import "server-only";

import { redis } from "@/actions/api/upstash";
import { Ratelimit } from "@upstash/ratelimit";
import { waitUntil } from "@vercel/functions";
import { headers } from "next/headers";

import { resolveClientIp } from "@/lib/net/clientIp";
import { timingSafeEqualSecret } from "@/lib/utils/timingSafeEqualSecret";

import type { RateLimitRule } from "./rateLimitRules";

async function getIpAddress(): Promise<string | null> {
  return resolveClientIp(await headers());
}

export type RateLimitRefusal =
  | { success: false; reason: "limited"; message: string; resetIn: number }
  | {
      success: false;
      reason: "unidentified" | "unavailable";
      message: string;
      resetIn?: never;
    };

export type RateLimitCheck = { success: true } | RateLimitRefusal;

export type RateLimitRequest = {
  operation: string;
  identifier: string | null | undefined;
  rule: RateLimitRule;
  bypassSecret?: string;
};

const LEGACY_DEFAULT_RULE: RateLimitRule = { limit: 20, windowSeconds: 60 };

/**
 * One limiter per operation, limit and window, kept for the life of the
 * instance. A limiter built per call cost an allocation per request and
 * lost its ephemeral cache, the in-memory list of callers already over the
 * limit that @upstash/ratelimit answers without a Redis round trip
 * (sourceRef: RegionRatelimitConfig.ephemeralCache).
 */
const limitersByKey = new Map<string, Ratelimit>();

function getLimiter(
  operationName: string,
  limit: number,
  windowSeconds: number,
): Ratelimit {
  const limiterKey = `${operationName}:${limit}:${windowSeconds}`;
  const cachedLimiter = limitersByKey.get(limiterKey);
  if (cachedLimiter) return cachedLimiter;
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    analytics: true,
    prefix: `ratelimit_${operationName}`,
  });
  limitersByKey.set(limiterKey, limiter);
  return limiter;
}

export async function checkRateLimit(request: RateLimitRequest): Promise<RateLimitCheck>;
/** @deprecated Pass a RateLimitRequest with a named rule from rateLimitRules.ts. */
export async function checkRateLimit(
  operationName: string,
  userId?: string | null,
  limit?: number,
  windowSeconds?: number,
  bypassSecret?: string,
): Promise<RateLimitCheck>;
export async function checkRateLimit(
  requestOrOperation: RateLimitRequest | string,
  userId?: string | null,
  limit: number = LEGACY_DEFAULT_RULE.limit,
  windowSeconds: number = LEGACY_DEFAULT_RULE.windowSeconds,
  bypassSecret?: string,
): Promise<RateLimitCheck> {
  const request: RateLimitRequest =
    typeof requestOrOperation === "string"
      ? {
          operation: requestOrOperation,
          identifier: userId,
          rule: { limit, windowSeconds },
          bypassSecret,
        }
      : requestOrOperation;
  const operationName = request.operation;
  try {
    const validBypassSecret = process.env.CRON_SECRET_KEY;
    if (
      request.bypassSecret &&
      validBypassSecret &&
      timingSafeEqualSecret(request.bypassSecret, validBypassSecret)
    ) {
      console.log(
        `[checkRateLimit] Rate limiting bypassed for operation: ${operationName}`
      );
      return { success: true };
    }

    const limiter = getLimiter(operationName, request.rule.limit, request.rule.windowSeconds);

    const identifier = request.identifier ?? (await getIpAddress());

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

    const { success, reset, pending } = await limiter.limit(identifier);
    // The analytics write finishes after the answer; waitUntil keeps the
    // function alive for it (sourceRef: @upstash/ratelimit LimitResponse.pending).
    waitUntil(pending);

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
