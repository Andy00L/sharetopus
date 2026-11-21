import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import type { CreatedVia } from "@/db/schema";
import type { SocialAccount } from "@/lib/types/dbTypes";
import { checkRateLimit } from "../rateLimit/checkRateLimit";
import { FETCH_SOCIAL_ACCOUNTS_RATE_LIMIT } from "@/actions/server/rateLimit/rateLimitRules";

export type SocialAccountsLoadFailure =
  | { success: false; reason: "rate_limited"; message: string; resetIn: number }
  | { success: false; reason: "unavailable"; message: string };

export type FetchSocialAccountsResult =
  | { success: true; data: SocialAccount[] }
  | SocialAccountsLoadFailure;

export async function fetchSocialAccounts(
  principalId: string,
  source: CreatedVia,
  filterByAvailability: boolean = true,
): Promise<FetchSocialAccountsResult> {
  try {
    console.log(
      `[fetchSocialAccounts] Fetching social accounts for principal: ${principalId}`,
      `Source: ${source}`,
    );

    const rateCheck = await checkRateLimit({
      operation: `${source}_fetch_social_accounts`,
      identifier: principalId,
      rule: FETCH_SOCIAL_ACCOUNTS_RATE_LIMIT,
    });

    if (!rateCheck.success) {
      return rateCheck.reason === "limited"
        ? {
            success: false,
            reason: "rate_limited",
            message: rateCheck.message,
            resetIn: rateCheck.resetIn,
          }
        : { success: false, reason: "unavailable", message: rateCheck.message };
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
        reason: "unavailable",
        message: "Failed to retrieve your social accounts.",
      };
    }

    return { success: true, data };
  } catch (err) {
    console.error(
      "[fetchSocialAccounts] Unexpected error fetching social accounts:",
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      reason: "unavailable",
      message:
        "An unexpected error occurred. Please try again or contact support.",
    };
  }
}
