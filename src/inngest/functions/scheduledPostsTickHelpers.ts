import "server-only";

import { and, asc, eq, inArray, lt, lte } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";
import type { PostStatus } from "@/db/schema";
import { POST_DUE_TARGET_COLUMNS } from "@/inngest/dispatch/sendPostDueEvents";
import type { PostDueTarget } from "@/inngest/events/postDue";
import { finalizeProcessingPost } from "./processSinglePostHelpers";

const UNCLAIMED_POST_STATUSES: PostStatus[] = ["scheduled", "queued"];

export type FetchUnclaimedPostsResult =
  | { success: true; targets: PostDueTarget[] }
  | { success: false; message: string };

export async function fetchUnclaimedPostsDueBy(input: {
  dueByIso: string;
  limit: number;
}): Promise<FetchUnclaimedPostsResult> {
  const { data, error } = await runQuery(
    db
      .select(POST_DUE_TARGET_COLUMNS)
      .from(scheduled_posts)
      .where(
        and(
          inArray(scheduled_posts.status, UNCLAIMED_POST_STATUSES),
          lte(scheduled_posts.scheduled_at, input.dueByIso),
        ),
      )
      .orderBy(asc(scheduled_posts.scheduled_at))
      .limit(input.limit),
  );

  if (error) {
    console.error("[fetchUnclaimedPostsDueBy] fetch failed:", error.message);
    return { success: false, message: `Failed to fetch due posts: ${error.message}` };
  }
  return { success: true, targets: data };
}

export type SettleStuckPostsResult =
  | { success: true; settledCount: number; failures: { postId: string; message: string }[] }
  | { success: false; message: string };

export async function settleStuckProcessingPosts(input: {
  claimedBeforeIso: string;
  limit: number;
  failureMessage: string;
}): Promise<SettleStuckPostsResult> {
  const { data: stuckPosts, error } = await runQuery(
    db
      .select()
      .from(scheduled_posts)
      .where(
        and(
          eq(scheduled_posts.status, "processing" satisfies PostStatus),
          lt(scheduled_posts.updated_at, input.claimedBeforeIso),
        ),
      )
      .orderBy(asc(scheduled_posts.updated_at))
      .limit(input.limit),
  );
  if (error) {
    console.error("[settleStuckProcessingPosts] fetch failed:", error.message);
    return { success: false, message: `Failed to fetch stuck posts: ${error.message}` };
  }

  let settledCount = 0;
  const failures: { postId: string; message: string }[] = [];
  for (const stuckPost of stuckPosts) {
    const finalized = await finalizeProcessingPost({
      post: stuckPost,
      failureMessage: input.failureMessage,
    });
    if (!finalized.success) {
      failures.push({ postId: stuckPost.id, message: finalized.message });
      continue;
    }
    if (finalized.updated) settledCount += 1;
  }
  return { success: true, settledCount, failures };
}
