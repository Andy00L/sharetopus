//rate-limit.ts
import "server-only";

import { redis } from "@/actions/api/upstash";
import { headers } from "next/headers";
import { Ratelimit } from "@upstash/ratelimit";

// Define result type to avoid 'any'
export type RateLimitResult<T> = {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
};

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
 * @param fn The function to rate-limit
 * @param operationName Name of operation (e.g., 'fetchdata')
 * @param userId Optional: User ID to use for rate limiting (overrides IP)
 * @param limit Number of requests allowed
 * @param window Time window in seconds
 */
export function withRateLimit<T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>,
  operationName: string,
  userId?: string | null,
  limit: number = 20,
  window: number = 60
): (...args: Args) => Promise<RateLimitResult<T>> {
  // Create a rate limiter for this function
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, `${window} s`),
    analytics: true,
    prefix: `ratelimit_${operationName}`,
  });

  // Return the rate-limited function
  return async (...args: Args): Promise<RateLimitResult<T>> => {
    let identifier: string | null = null;

    // Use the provided userId if available
    if (userId) {
      identifier = userId;
    } else {
      // Fallback to IP-based rate limiting
      const ipAddress = await getIpAddress();
      identifier = ipAddress;
    }

    // If no identifier is available, return an error
    if (!identifier) {
      return {
        success: false,
        message: "Rate limit identifier not available",
        error: "No identifier found for rate limiting",
      };
    }

    // Apply rate limiting
    try {
      const { success } = await limiter.limit(identifier);
      if (!success) {
        return {
          success: false,
          message: "Rate limit exceeded. Please try again later.",
        };
      }
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Rate limit check failed",
        error: error instanceof Error ? error.message : undefined,
      };
    }

    // Run the function if within rate limit
    try {
      const result = await fn(...args);
      return {
        success: true,
        message: "Success",
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Function execution failed",
        error: error instanceof Error ? error.message : undefined,
      };
    }
  };
}
