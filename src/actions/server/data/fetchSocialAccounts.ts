import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/server/authCheck";
import { SocialAccount } from "@/lib/types/dbTypes";
import "server-only";

import { checkRateLimit } from "../rateLimit/checkRateLimit";

/**
 * Fetches social accounts for a specific user with optional availability filtering
 *
 * @param userId - The ID of the user whose social accounts to fetch
 * @param filterByAvailability - When true, only returns available accounts (default: true)
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

    // Step 2: Check rate limits to prevent abuse
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

    // Step 3: Build and execute the database query
    // Start building the query
    let query = adminSupabase
      .from("social_accounts")
      .select("*")
      .eq("user_id", userId);

    // Only apply the availability filter if requested
    if (filterByAvailability) {
      query = query.eq("is_available", true);
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
