import "server-only";

import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";

import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";
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

const GRACE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_PRINCIPALS_PER_RUN = 500;

export async function cleanupCancelledPostsAfterGrace(
  now: Date = new Date(),
): Promise<CleanupResult> {
  const cutoffIso = new Date(now.getTime() - GRACE_DAYS * MS_PER_DAY).toISOString();

  const { data: principalRows, error: principalsError } = await runQuery(
    db
      .selectDistinct({ principal_id: scheduled_posts.principal_id })
      .from(scheduled_posts)
      .where(isCancelledBySubscription())
      .limit(MAX_PRINCIPALS_PER_RUN),
  );
  if (principalsError) {
    return {
      success: false,
      message: `[cleanupCancelledPostsAfterGrace] Principal query failed: ${principalsError.message}`,
    };
  }

  const lapsedPrincipalIds: string[] = [];
  const failures: string[] = [];
  let principalsResumed = 0;
  let resumedPosts = 0;

  for (const { principal_id: principalId } of principalRows) {
    const access = await checkActiveSubscription(principalId);
    if (access.status === "unavailable") {
      failures.push(`access check failed for ${principalId}`);
      continue;
    }
    if (!access.isActive) {
      lapsedPrincipalIds.push(principalId);
      continue;
    }
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
    `[cleanupCancelledPostsAfterGrace] principals=${principalRows.length} resumedPrincipals=${principalsResumed} resumedPosts=${resumedPosts} deleted=${deletion.deleted} failures=${failures.length}`,
  );

  if (failures.length > 0) {
    return {
      success: false,
      message: `[cleanupCancelledPostsAfterGrace] ${failures.length} principal(s) not reconciled, first: ${failures[0]}`,
    };
  }

  return {
    success: true,
    principalsChecked: principalRows.length,
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
