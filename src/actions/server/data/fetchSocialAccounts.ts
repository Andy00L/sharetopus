import "server-only";

import { and, eq } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import type { CreatedVia } from "@/db/schema";
import type { SocialAccount } from "@/lib/types/dbTypes";
import { checkRateLimit } from "../rateLimit/checkRateLimit";

/**
 * Fetches social accounts for a given principal with optional availability filtering.
 *
 * **Authentication:** Does not call Clerk. Caller must validate `principalId` before
 * calling (e.g. `auth()` in RSC for `"web"`, MCP principal for `"mcp"`).
 *
 * **Rate limiting:** 30 requests per 60s, scoped per `source` + `principalId`
 * (e.g. `web_fetch_social_accounts`, `mcp_fetch_social_accounts`).
 *
 * **Tables:** `social_accounts`.
 *
 * @param principalId - Matches `social_accounts.principal_id`.
 * @param source - Channel label; used to build the rate-limit scope.
 * @param filterByAvailability - When true (default), only returns rows where `is_available = true`.
 * @returns Success flag, user-facing message, optional `data`, and `resetIn` seconds when rate limited.
 */
export async function fetchSocialAccounts(
  principalId: string,
  source: CreatedVia,
  filterByAvailability: boolean = true,
): Promise<{
  success: boolean;
  message: string;
  data?: SocialAccount[];
  resetIn?: number;
}> {
  try {
    console.log(
      `[fetchSocialAccounts] Fetching social accounts for principal: ${principalId}`,
      `Source: ${source}`,
    );

    // Step 1: Check rate limits to prevent abuse
    const rateLimitScope = `${source}_fetch_social_accounts`;

    const rateCheck = await checkRateLimit(
      rateLimitScope, // Unique identifier per channel
      principalId, // Principal identifier
      30, // Limit (30 requests)
      60, // Window (60 seconds)
    );

    if (!rateCheck.success) {
      return {
        success: false,
        message: "Too many requests. Please try again later.",
        resetIn: rateCheck.resetIn,
      };
    }

    // Step 2: Build and execute the database query. The availability
    // filter only applies when requested (and() drops the undefined entry).
    const { data, error } = await runQuery(
      db
        .select()
        .from(social_accounts)
        .where(
          and(
            eq(social_accounts.principal_id, principalId),
            filterByAvailability
              ? eq(social_accounts.is_available, true)
              : undefined,
          ),
        ),
    );

    if (error) {
      console.error("[fetchSocialAccounts] DB error:", error.message);
      return {
        success: false,
        message: "Failed to retrieve your social accounts.",
      };
    }

    // Step 3: Check if data exists
    if (data.length === 0) {
      console.log(
        `[fetchSocialAccounts]: No social accounts found for principal: ${principalId}`,
      );
      return {
        success: true,
        message: "No social accounts found.",
        data: [],
      };
    }

    // Step 4: Return successful response with data
    return {
      success: true,
      message: "Social accounts retrieved successfully.",
      data,
    };
  } catch (err) {
    // Step 5: Handle unexpected errors
    console.error(
      `[fetchSocialAccounts]: Unexpected error fetching social accounts:`,
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      message:
        "An unexpected error occurred. Please try again or contact support.",
    };
  }
}
