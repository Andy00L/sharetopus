import "server-only";

import { SocialAccount } from "@/lib/types/dbTypes";
import { fetchSocialAccounts } from "./server/data/fetchSocialAccounts";
import { disconnectSocialAccount } from "./server/disconnectSocialAccount";
import { withRateLimit } from "./server/reddis/rate-limit";

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
    10, // 10 requests
    60 // per 60 seconds
  );

  // Call the rate limited function with the original parameters
  return rateLimitedFn(accountId, userId);
}
