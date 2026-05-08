import "server-only";
import { adminSupabase } from "@/actions/api/adminSupabase";
import type { Platform, PostStatus } from "@/lib/types/database.types";

export type DuePost = {
  id: string;
  principal_id: string;
  social_account_id: string;
  platform: Platform;
  scheduled_at: string;
};

export type FetchDueResult =
  | { success: true; message: string; posts: DuePost[] }
  | { success: false; message: string; posts: [] };

export async function fetchDueScheduledPosts(
  nowIso: string,
  limit: number
): Promise<FetchDueResult> {
  const { data, error } = await adminSupabase
    .from("scheduled_posts")
    .select("id, principal_id, social_account_id, platform, scheduled_at")
    .eq("status", "scheduled" satisfies PostStatus)
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[scheduledPostsTick] fetch failed:", error.message);
    return {
      success: false,
      message: `Failed to fetch due posts: ${error.message}`,
      posts: [],
    };
  }
  return {
    success: true,
    message: `Fetched ${data.length} due posts`,
    posts: data as DuePost[],
  };
}

export type MarkQueuedResult =
  | { success: true; message: string; updated: number }
  | { success: false; message: string; updated: 0 };

/**
 * Idempotent: only flips rows still in 'scheduled' state. Concurrent
 * tick attempts cannot double-update.
 */
export async function markPostsAsQueued(
  postIds: string[]
): Promise<MarkQueuedResult> {
  if (postIds.length === 0) {
    return { success: true, message: "Nothing to mark", updated: 0 };
  }
  const { data, error } = await adminSupabase
    .from("scheduled_posts")
    .update({
      status: "queued" satisfies PostStatus,
      updated_at: new Date().toISOString(),
    })
    .in("id", postIds)
    .eq("status", "scheduled" satisfies PostStatus)
    .select("id");

  if (error) {
    console.error("[scheduledPostsTick] mark queued failed:", error.message);
    return {
      success: false,
      message: `Failed to mark queued: ${error.message}`,
      updated: 0,
    };
  }
  return {
    success: true,
    message: `Marked ${data?.length ?? 0} as queued`,
    updated: data?.length ?? 0,
  };
}
