import "server-only";

import { inArray } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";
import type { PostStatus } from "@/lib/types/database.types";
import type { PreflightResult } from "@/lib/types/preflight";

/**
 * Pre-payment check shared by cancel, delete and reschedule. It mirrors the
 * rules the three batch functions enforce (cancelScheduledPostBatch,
 * deleteScheduledPostBatch, updateScheduledTimeBatch): at least one of the
 * ids must exist, none may belong to another principal, and when
 * eligibleStatuses is given at least one post must be in one of them. A paid
 * caller (x402) runs it before settlement so a change that cannot happen
 * costs nothing; the batch functions still enforce the same rules.
 *
 * Called by: src/app/api/x402/{cancel,delete,reschedule}/route.ts
 * Tables touched: scheduled_posts (read)
 */
export async function preflightScheduledPostChange(params: {
  postIds: string[];
  principalId: string;
  eligibleStatuses: readonly PostStatus[] | null;
}): Promise<PreflightResult> {
  const { data: posts, error } = await runQuery(
    db
      .select({
        principal_id: scheduled_posts.principal_id,
        status: scheduled_posts.status,
      })
      .from(scheduled_posts)
      .where(inArray(scheduled_posts.id, params.postIds)),
  );

  if (error) {
    console.error(`[preflightScheduledPostChange] scheduled_posts read failed: ${error.message}`);
    return { ok: false, httpStatus: 500, errorKind: "precheck_failed", message: "Could not look up the posts." };
  }
  if (posts.length === 0) {
    return { ok: false, httpStatus: 404, errorKind: "posts_not_found", message: "No posts found for these ids." };
  }
  if (posts.some((post) => post.principal_id !== params.principalId)) {
    return {
      ok: false,
      httpStatus: 403,
      errorKind: "post_not_owned",
      message: "Some of these posts do not belong to the paying wallet.",
    };
  }

  const eligibleStatuses = params.eligibleStatuses;
  if (eligibleStatuses && !posts.some((post) => eligibleStatuses.includes(post.status))) {
    return {
      ok: false,
      httpStatus: 409,
      errorKind: "no_eligible_posts",
      message: `None of these posts is in an eligible state (${eligibleStatuses.join(", ")}).`,
    };
  }

  return { ok: true };
}
