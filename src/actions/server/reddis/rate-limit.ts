// lib/rate-limit.ts
"server only";

import { redis } from "@/actions/api/upstash";
import { headers } from "next/headers";
import { Ratelimit } from "@upstash/ratelimit";

// Define result type to avoid 'any'
export type RateLimitResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

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
 * @param operationName Name of operation (e.g., 'fetchCards')
 * @param limit Number of requests allowed
 * @param window Time window in seconds
 */
export function withRateLimit<T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>,
  operationName: string,
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
    // Try to get the IP address
    const ipAddress = await getIpAddress();

    // Skip rate limiting if IP can't be determined
    if (!ipAddress) {
      try {
        const result = await fn(...args);
        return { success: true, data: result };
      } catch (error) {
        throw error;
      }
    }

    // Apply rate limiting
    const { success } = await limiter.limit(ipAddress);

    // Return error if rate limited
    if (!success) {
      return {
        success: false,
        error: "Rate limit exceeded. Please try again later.",
      };
    }

    // Run the function if within rate limit
    try {
      const result = await fn(...args);
      return { success: true, data: result };
    } catch (error) {
      throw error;
    }
  };
}
