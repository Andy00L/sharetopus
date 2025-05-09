import "server-only";

import { ScheduledPost, SocialAccount } from "@/lib/types/dbTypes";
import { disconnectSocialAccount } from "./server/accounts/disconnectSocialAccount";
import { fetchSocialAccounts } from "./server/data/fetchSocialAccounts";
import { withRateLimit } from "./server/reddis/rate-limit";
import { getScheduledPosts } from "./server/scheduleActions/getScheduledPosts";

/**
 * Rate-limited version of fetchSocialAccounts
 * Limited to 30 requests per minute per user
 */

export async function fetchSocialAccountsProtected(
  userId: string | null
): Promise<{ success: boolean; message: string; data?: SocialAccount[] }> {
  // Create the rate limited function with the provided userId
  const rateLimitedFn = withRateLimit(
    fetchSocialAccounts,
    "fetchSocialAccounts",
    userId,
    30, // 30 requests
    60 // per 60 seconds
  );

  // Call the rate limited function with the same userId
  return rateLimitedFn(userId);
}

/**
 * Rate-limited version of disconnectSocialAccount
 * Limited to 10 requests per minute per user
 */
export async function disconnectSocialAccountProtected(
  accountId: string,
  userId: string
): Promise<{ success: boolean; message: string }> {
  // Create the rate limited function with the provided userId
  const rateLimitedFn = withRateLimit(
    disconnectSocialAccount,
    "disconnectSocialAccount",
    userId,
    15, // 10 requests
    60 // per 60 seconds
  );

  // Call the rate limited function with the original parameters
  return rateLimitedFn(accountId, userId);
}

/**
 * Rate-limited version of getScheduledPosts
 * Limited to 30 requests per minute per user
 */
export async function getScheduledPostsProtected(
  userId: string | null
): Promise<{ posts: ScheduledPost[]; rateLimited: boolean }> {
  // Create the rate limited function with the provided userId
  const rateLimitedFn = withRateLimit(
    getScheduledPosts,
    "getScheduledPosts",
    userId,
    30, // 30 requests
    60 // per 60 seconds
  );

  try {
    const result = await rateLimitedFn(userId);
    return {
      posts: result.data || [],
      rateLimited: !result.success,
    };
  } catch (error) {
    console.error("[getScheduledPostsProtected] Error:", error);
    return {
      posts: [],
      rateLimited: false,
    };
  }
}
