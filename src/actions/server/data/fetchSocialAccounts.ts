import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import type { CreatedVia } from "@/db/schema";
import type { SocialAccount } from "@/lib/types/dbTypes";
import { checkRateLimit } from "../rateLimit/checkRateLimit";

/**
 * The principal's social accounts, never deleted ones; filterByAvailability
 * keeps only is_available rows. Caller validates principalId. 30 calls per 60 s per source.
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

    const rateCheck = await checkRateLimit(
      `${source}_fetch_social_accounts`,
      principalId,
      30,
      60,
    );

    if (!rateCheck.success) {
      return {
        success: false,
        message: rateCheck.message,
        resetIn: rateCheck.resetIn,
      };
    }

    const { data, error } = await runQuery(
      db
        .select()
        .from(social_accounts)
        .where(
          and(
            eq(social_accounts.principal_id, principalId),
            isNull(social_accounts.deleted_at),
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

    return {
      success: true,
      message: "Social accounts retrieved successfully.",
      data,
    };
  } catch (err) {
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
