import "server-only";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/authCheck";
import { SocialAccount } from "@/lib/types/dbTypes";

import { checkRateLimit } from "../reddis/rate-limit";

/**
 * Fetches social accounts for a specific user with optional availability filtering
 *
 * This function:
 * 1. Verifies user authentication
 * 2. Performs rate limiting to prevent abuse (max 30 requests per minute)
 * 3. Queries the database for the user's social accounts
 * 4. Optionally filters accounts by availability status
 * 5. Returns a structured response with the account data or error information
 *
 * @param userId - The ID of the user whose social accounts to fetch
 * @param filterByAvailability - When true, only returns accounts marked as available (default: true)
 * @returns Structured response with success status, message, and optional account data
 */
export async function fetchSocialAccounts(
  userId: string | null,
  filterByAvailability: boolean = true
): Promise<{
  success: boolean;
  message: string;
  data?: SocialAccount[];
  resetIn?: number;
}> {
  try {
    console.log(
      `[fetchSocialAccounts]: Starting social accounts fetch for user: ${userId}`
    );

    // Verify user is properly authenticated
    const authResult = await authCheck(userId);
    if (!authResult) {
      console.error(
        `[fetchSocialAccounts]: Authentication check failed for user ID: ${userId}`
      );
      return {
        success: false,
        message: "Authentication validation failed. Please sign in again.",
      };
    }
    console.log(
      `[fetchSocialAccounts]: Authentication validated for user: ${userId}`
    );

    // Step 2: Check rate limits to prevent abuse
    console.log(
      `[fetchSocialAccounts]: Checking rate limits for user: ${userId}`
    );
    const rateCheck = await checkRateLimit(
      "fetchSocialAccounts", // Unique identifier for this operation
      userId, // User identifier
      30, // Limit (30 requests)
      60 // Window (60 seconds)
    );
    if (!rateCheck.success) {
      console.warn(
        `[fetchSocialAccounts]: Rate limit exceeded for user: ${userId}. Reset in: ${
          rateCheck.resetIn ?? "unknown"
        } seconds`
      );
      return {
        success: false,
        message: "Too many requests. Please try again later.",
        resetIn: rateCheck.resetIn,
      };
    }
    console.log(
      `[fetchSocialAccounts]: Rate limit check passed for user: ${userId}`
    );

    // Step 3: Build and execute the database query
    console.log(
      `[fetchSocialAccounts]: Querying database for social accounts, filter by availability: ${filterByAvailability}`
    );

    // Start building the query
    let query = adminSupabase
      .from("social_accounts")
      .select("*")
      .eq("user_id", userId);

    // Only apply the availability filter if requested
    if (filterByAvailability) {
      query = query.eq("is_availble", true);
    }

    // Execute the query
    const { data, error } = await query;

    if (error) {
      console.error(
        `[fetchSocialAccounts]: Database error fetching social accounts:`,
        error.message,
        error.details
      );
      return {
        success: false,
        message:
          "Failed to retrieve your social accounts. Please try again later.",
      };
    }

    // Step 5: Check if data exists
    if (!data || data.length === 0) {
      console.log(
        `[fetchSocialAccounts]: No social accounts found for user: ${userId}`
      );
      return {
        success: true,
        message: "No social accounts found.",
        data: [],
      };
    }

    // Step 6: Return successful response with data
    console.log(
      `[fetchSocialAccounts]: Successfully fetched ${data.length} social accounts for user: ${userId}`
    );
    return {
      success: true,
      message: "Social accounts retrieved successfully.",
      data: data as SocialAccount[],
    };
  } catch (err) {
    // Step 7: Handle unexpected errors
    console.error(
      `[fetchSocialAccounts]: Unexpected error fetching social accounts:`,
      err instanceof Error ? err.message : err
    );
    return {
      success: false,
      message:
        "An unexpected error occurred. Please try again or contact support.",
    };
  }
}
