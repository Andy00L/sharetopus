import "server-only";

import { and, asc, eq, inArray, lte, or } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";
import type { PostStatus } from "@/db/schema";

export type DuePost = Pick<
  typeof scheduled_posts.$inferSelect,
  "id" | "principal_id" | "social_account_id" | "platform" | "scheduled_at"
>;

export type FetchDueResult =
  | { success: true; message: string; posts: DuePost[] }
  | { success: false; message: string; posts: [] };

export async function fetchDueScheduledPosts(
  nowIso: string,
  limit: number
): Promise<FetchDueResult> {
  const { data, error } = await runQuery(
    db
      .select({
        id: scheduled_posts.id,
        principal_id: scheduled_posts.principal_id,
        social_account_id: scheduled_posts.social_account_id,
        platform: scheduled_posts.platform,
        scheduled_at: scheduled_posts.scheduled_at,
      })
      .from(scheduled_posts)
      .where(
        and(
          eq(scheduled_posts.status, "scheduled" satisfies PostStatus),
          lte(scheduled_posts.scheduled_at, nowIso),
        ),
      )
      .orderBy(asc(scheduled_posts.scheduled_at))
      .limit(limit),
  );

  if (error) {
    console.error("[fetchDueScheduledPosts] fetch failed:", error.message);
    return {
      success: false,
      message: `Failed to fetch due posts: ${error.message}`,
      posts: [],
    };
  }
  return {
    success: true,
    message: `Fetched ${data.length} due posts`,
    posts: data,
  };
}

export type MarkQueuedResult =
  | { success: true; message: string; updated: number }
  | { success: false; message: string; updated: 0 };

export async function markPostsAsQueued(
  dispatchedPosts: Pick<DuePost, "id" | "scheduled_at">[],
): Promise<MarkQueuedResult> {
  if (dispatchedPosts.length === 0) {
    return { success: true, message: "Nothing to mark", updated: 0 };
  }
  const { data, error } = await runQuery(
    db
      .update(scheduled_posts)
      .set({
        status: "queued" satisfies PostStatus,
        updated_at: new Date().toISOString(),
      })
      .where(
        and(
          inArray(
            scheduled_posts.id,
            dispatchedPosts.map((dispatchedPost) => dispatchedPost.id),
          ),
          eq(scheduled_posts.status, "scheduled" satisfies PostStatus),
          or(
            ...dispatchedPosts.map((dispatchedPost) =>
              and(
                eq(scheduled_posts.id, dispatchedPost.id),
                eq(scheduled_posts.scheduled_at, dispatchedPost.scheduled_at),
              ),
            ),
          ),
        ),
      )
      .returning({ id: scheduled_posts.id }),
  );

  if (error) {
    console.error("[markPostsAsQueued] mark queued failed:", error.message);
    return {
      success: false,
      message: `Failed to mark queued: ${error.message}`,
      updated: 0,
    };
  }
  return {
    success: true,
    message: `Marked ${data.length} as queued`,
    updated: data.length,
  };
}
