import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import type { SocialAccount } from "@/lib/types/dbTypes";

export type FetchAccountForPublishResult =
  | { success: true; account: SocialAccount }
  | {
      success: false;
      /** not_found: deleted or never existed. lookup_failed: the read failed. */
      reason: "not_found" | "lookup_failed";
      message: string;
    };

/**
 * The social account row a publish or a status poll needs, OAuth tokens
 * included. Call it inside the Inngest step that uses the tokens and never
 * return the account from a step: Inngest stores every step result, so a
 * returned row would keep the tokens in the run's history.
 *
 * Called by: processSinglePost, processDirectPost,
 * resolveTikTokAccessTokenForAccount
 */
export async function fetchAccountForPublish(
  socialAccountId: string,
): Promise<FetchAccountForPublishResult> {
  const { data: accountRows, error } = await runQuery(
    db
      .select()
      .from(social_accounts)
      .where(
        and(
          eq(social_accounts.id, socialAccountId),
          isNull(social_accounts.deleted_at),
        ),
      )
      .limit(1),
  );

  if (error) {
    console.error(
      `[fetchAccountForPublish] Account ${socialAccountId} lookup failed:`,
      error.message,
    );
    return {
      success: false,
      reason: "lookup_failed",
      message: `Failed to fetch account: ${error.message}`,
    };
  }

  const account = accountRows[0];
  if (!account) {
    return {
      success: false,
      reason: "not_found",
      message: "Social account not found or deleted",
    };
  }
  return { success: true, account };
}
