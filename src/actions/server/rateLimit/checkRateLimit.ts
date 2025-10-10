//rate-limit.ts
import "server-only";

import { redis } from "@/actions/api/upstash";
import { Ratelimit } from "@upstash/ratelimit";
import { headers } from "next/headers";

/**
 * Get the client IP address from request headers
 * Returns null if IP can't be determined
 */
async function getIpAddress(): Promise<string | null> {
  const headersList = await headers();

  // Try different headers to get IP (order matters - most reliable first)
  const forwardedFor = headersList.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  const realIp = headersList.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  return null;
}

/**
 * Apply rate limiting to any operation
 *
 * @param operationName - Name of operation (e.g., 'fetchData', 'submitForm')
 * @param userId - Optional user ID for rate limiting (overrides IP-based limiting)
 * @param limit - Number of requests allowed (default: 20)
 * @param window - Time window in seconds (default: 60)
 * @param bypassSecret - Optional secret to bypass rate limiting (for internal/cron use)
 * @returns Object with success status and optional reset time
 */
export async function checkRateLimit(
  operationName: string,
  userId?: string | null,
  limit: number = 20,
  window: number = 60,
  bypassSecret?: string | undefined
): Promise<{ success: boolean; message?: string; resetIn?: number }> {
  try {
    // Check for valid bypass secret
    const validBypassSecret = process.env.CRON_SECRET_KEY;
    if (
      bypassSecret &&
      validBypassSecret &&
      bypassSecret === validBypassSecret
    ) {
      console.log(
        `[checkRateLimit] Rate limiting bypassed for operation: ${operationName}`
      );
      return {
        success: true,
        message: "Rate limiting bypassed",
      };
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
      };
    }

    // Apply rate limiting
    const { success, reset } = await limiter.limit(identifier);

    if (success) {
      return {
        success: true,
      };
    }

    // Calculate reset time
    const resetInSeconds = Math.ceil((reset - Date.now()) / 1000);
    console.warn(
      `[checkRateLimit] Rate limit exceeded for operation: ${operationName}, reset in: ${resetInSeconds}s`
    );

    return {
      success: false,
      message: "Rate limit exceeded. Please try again later.",
      resetIn: resetInSeconds,
    };
  } catch (error) {
    console.error(
      `[checkRateLimit] Rate limit check failed for operation: ${operationName}`,
      error instanceof Error ? error.message : error
    );

    return {
      success: false,
      message: "Rate limit check failed",
    };
  }
}
