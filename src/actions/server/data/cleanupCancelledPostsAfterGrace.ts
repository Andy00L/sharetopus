import "server-only";

import { and, eq, inArray, isNotNull, lt, min } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import {
  ACCESS_GRANTING_SUBSCRIPTION_STATUSES,
  scheduled_posts,
  stripe_subscriptions,
  users,
} from "@/db/schema";
import { resumeCancelledPostsOnResubscribe } from "./resumeCancelledPostsOnResubscribe";

export type CleanupResult =
  | {
      success: true;
      principalsChecked: number;
      principalsResumed: number;
      resumedPosts: number;
      deleted: number;
    }
  | { success: false; message: string };

type AccessLookup =
  | { success: true; principalIdsWithAccess: Set<string> }
  | { success: false; message: string };

const GRACE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_PRINCIPALS_PER_RUN = 500;

export async function cleanupCancelledPostsAfterGrace(
  now: Date = new Date(),
): Promise<CleanupResult> {
  const cutoffIso = new Date(now.getTime() - GRACE_DAYS * MS_PER_DAY).toISOString();

  const { data: principalRows, error: principalsError } = await runQuery(
    db
      .select({ principal_id: scheduled_posts.principal_id })
      .from(scheduled_posts)
      .where(isCancelledBySubscription())
      .groupBy(scheduled_posts.principal_id)
      .orderBy(min(scheduled_posts.cancelled_by_sub_at))
      .limit(MAX_PRINCIPALS_PER_RUN),
  );
  if (principalsError) {
    return {
      success: false,
      message: `[cleanupCancelledPostsAfterGrace] Principal query failed: ${principalsError.message}`,
    };
  }
  const principalIds = principalRows.map((row) => row.principal_id);

  const access = await findPrincipalsWithAccess(principalIds, now);
  if (!access.success) return access;

  const lapsedPrincipalIds = principalIds.filter(
    (principalId) => !access.principalIdsWithAccess.has(principalId),
  );
  const failures: string[] = [];
  let principalsResumed = 0;
  let resumedPosts = 0;

  for (const principalId of access.principalIdsWithAccess) {
    const resumeResult = await resumeCancelledPostsOnResubscribe(principalId);
    if (!resumeResult.success) {
      failures.push(resumeResult.message);
      continue;
    }
    principalsResumed++;
    resumedPosts += resumeResult.resumed;
  }

  const deletion = await deleteLapsedPostsPastGrace(lapsedPrincipalIds, cutoffIso);
  if (!deletion.success) return deletion;

  console.log(
    `[cleanupCancelledPostsAfterGrace] principals=${principalIds.length} resumedPrincipals=${principalsResumed} resumedPosts=${resumedPosts} deleted=${deletion.deleted} failures=${failures.length}`,
  );

  if (failures.length > 0) {
    return {
      success: false,
      message: `[cleanupCancelledPostsAfterGrace] ${failures.length} principal(s) not resumed, first: ${failures[0]}`,
    };
  }

  return {
    success: true,
    principalsChecked: principalIds.length,
    principalsResumed,
    resumedPosts,
    deleted: deletion.deleted,
  };
}

function isCancelledBySubscription() {
  return and(
    eq(scheduled_posts.status, "cancelled"),
    isNotNull(scheduled_posts.cancelled_by_sub_at),
  );
}

async function findPrincipalsWithAccess(
  principalIds: string[],
  now: Date,
): Promise<AccessLookup> {
  const principalIdsWithAccess = new Set<string>();
  if (principalIds.length === 0) return { success: true, principalIdsWithAccess };

  const { data: subscribedRows, error: subscriptionsError } = await runQuery(
    db
      .selectDistinct({ user_id: stripe_subscriptions.user_id })
      .from(stripe_subscriptions)
      .where(
        and(
          inArray(stripe_subscriptions.user_id, principalIds),
          inArray(stripe_subscriptions.status, [...ACCESS_GRANTING_SUBSCRIPTION_STATUSES]),
        ),
      ),
  );
  if (subscriptionsError) {
    return {
      success: false,
      message: `[findPrincipalsWithAccess] Subscription read failed: ${subscriptionsError.message}`,
    };
  }
  for (const row of subscribedRows) principalIdsWithAccess.add(row.user_id);

  const unsubscribedIds = principalIds.filter(
    (principalId) => !principalIdsWithAccess.has(principalId),
  );
  if (unsubscribedIds.length === 0) return { success: true, principalIdsWithAccess };

  const { data: referralRows, error: referralError } = await runQuery(
    db
      .select({ id: users.id, creator_access_until: users.creator_access_until })
      .from(users)
      .where(and(inArray(users.id, unsubscribedIds), isNotNull(users.creator_access_until))),
  );
  if (referralError) {
    return {
      success: false,
      message: `[findPrincipalsWithAccess] Referral access read failed: ${referralError.message}`,
    };
  }
  for (const row of referralRows) {
    if (row.creator_access_until && new Date(row.creator_access_until) > now) {
      principalIdsWithAccess.add(row.id);
    }
  }
  return { success: true, principalIdsWithAccess };
}

async function deleteLapsedPostsPastGrace(
  lapsedPrincipalIds: string[],
  cutoffIso: string,
): Promise<{ success: true; deleted: number } | { success: false; message: string }> {
  if (lapsedPrincipalIds.length === 0) return { success: true, deleted: 0 };

  const { data: deletedRows, error } = await runQuery(
    db
      .delete(scheduled_posts)
      .where(
        and(
          inArray(scheduled_posts.principal_id, lapsedPrincipalIds),
          isCancelledBySubscription(),
          lt(scheduled_posts.cancelled_by_sub_at, cutoffIso),
        ),
      )
      .returning({ id: scheduled_posts.id }),
  );
  if (error) {
    return {
      success: false,
      message: `[cleanupCancelledPostsAfterGrace] Delete failed: ${error.message}`,
    };
  }
  return { success: true, deleted: deletedRows.length };
}
