import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import type { PostRejection } from "@/lib/types/postBatch";

/**
 * The platform of each listed social account the principal owns, keyed by
 * account id, in one query. An id missing from the map is not the
 * principal's or was deleted (a deleted account cannot publish).
 *
 * Called by: directPostBatch, schedulePostBatch, and their pre-payment
 * checks (preflightDirectPost, preflightSchedulePost)
 */
export async function loadOwnedAccountPlatforms(
  socialAccountIds: string[],
  principalId: string,
): Promise<
  | { success: true; platformByAccountId: Map<string, string> }
  | { success: false; message: string }
> {
  const uniqueIds = [...new Set(socialAccountIds)];
  const { data: ownedRows, error } = await runQuery(
    db
      .select({ id: social_accounts.id, platform: social_accounts.platform })
      .from(social_accounts)
      .where(
        and(
          eq(social_accounts.principal_id, principalId),
          isNull(social_accounts.deleted_at),
          inArray(social_accounts.id, uniqueIds),
        ),
      ),
  );
  if (error) {
    return { success: false, message: `Ownership check failed: ${error.message}` };
  }
  return {
    success: true,
    platformByAccountId: new Map(
      ownedRows.map((ownedRow) => [ownedRow.id, ownedRow.platform]),
    ),
  };
}

/**
 * Why a post cannot go to its account: the principal does not own it, or
 * the account is on another platform than the post declares. Null when the
 * post can go ahead.
 */
export function describeAccountMismatch(
  platformByAccountId: Map<string, string>,
  post: { socialAccountId: string; platform: string },
): PostRejection | null {
  const accountPlatform = platformByAccountId.get(post.socialAccountId);
  if (!accountPlatform) {
    return {
      socialAccountId: post.socialAccountId,
      code: "not_owned",
      reason: "You do not own this social account.",
    };
  }
  if (accountPlatform !== post.platform) {
    return {
      socialAccountId: post.socialAccountId,
      code: "platform_mismatch",
      reason: `Account platform is ${accountPlatform}, post declared ${post.platform}.`,
    };
  }
  return null;
}
