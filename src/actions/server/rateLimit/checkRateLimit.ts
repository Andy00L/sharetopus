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

  // Try different headers to get IP
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
 * Apply rate limiting to any function
 *
 * @param operationName Name of operation (e.g., 'fetchdata')
 * @param userId Optional: User ID to use for rate limiting (overrides IP)
 * @param limit Number of requests allowed
 * @param window Time window in seconds
 */
export async function checkRateLimit(
  operationName: string,
  userId?: string | null,
  limit: number = 20,
  window: number = 60,
  cronSecret?: string | undefined
): Promise<{ success: boolean; message?: string; resetIn?: number }> {
  try {
    // If this is a cron job request and it has the correct secret, bypass Clerk auth
    if (cronSecret == process.env.CRON_SECRET_KEY) {
      console.log(
        `[Rate-limit] Bypassing Rate Limitfor cron job request for user ${userId}`
      );
      return {
        success: true,
        message: " Bypassing Rate Limitfor cron job request for user ${userId}",
      };
    }

    // Create a rate limiter for this function
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
        `[Rate-limit] Failed to determine identifier: No user ID provided and IP address could not be retrieved`
      );

      return { success: false, message: "No identifier for rate limiting" };
    }
    console.log(
      `[Rate-limit] Using identifier: ${
        userId ? "User ID" : "IP address"
      } (${identifier.substring(0, 8)}...)`
    );

    // Apply rate limiting
    const { success, reset } = await limiter.limit(identifier);

    if (success) {
      console.log(`[Rate-limit] Request permitted: Rate limit not exceeded`);
      return {
        success: true,
      };
    } else {
      // Format the reset time nicely
      const resetInSeconds = Math.ceil((reset - Date.now()) / 1000);
      console.warn(
        `[Rate-limit] Request rejected: Rate limit exceeded. Reset in ${resetInSeconds} seconds`
      );
      return {
        success: false,
        message: "Rate limit exceeded. Please try again later.",
        resetIn: resetInSeconds,
      };
    }
  } catch (error) {
    console.error("[Rate-limit] Rate limit check failed", error);
    return {
      success: false,
      message: "Rate limit check failed",
    };
  }
}
