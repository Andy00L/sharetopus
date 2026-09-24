import "server-only";
import { and, eq, sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { pending_tiktok_pulls } from "@/db/schema";
import type { PendingTikTokPull } from "@/lib/types/dbTypes";

/**
 * Inserts a new pending TikTok pull record. Called after a successful
 * TikTok init (image or video) returns a publish_id. The row tracks
 * the async pull so cleanup logic can gate file deletion on pull
 * completion.
 *
 * Returns: { success: true } or { success: false, message }.
 * Persists: one row in pending_tiktok_pulls with status='pending'.
 */
export async function insertPendingTikTokPull(input: {
  publish_id: string;
  principal_id: string;
  social_account_id: string;
  scheduled_post_id?: string | null;
  content_history_id?: string | null;
  media_storage_path: string;
  creator_username: string | null;
}): Promise<{ success: true } | { success: false; message: string }> {
  const { error } = await runQuery(
    db.insert(pending_tiktok_pulls).values({
      publish_id: input.publish_id,
      principal_id: input.principal_id,
      social_account_id: input.social_account_id,
      scheduled_post_id: input.scheduled_post_id ?? null,
      content_history_id: input.content_history_id ?? null,
      media_storage_path: input.media_storage_path,
      creator_username: input.creator_username,
      status: "pending",
      attempt_count: 0,
    }),
  );

  if (error) {
    console.error(
      "[insertPendingTikTokPull] Insert failed:",
      error.message
    );
    return { success: false, message: `Insert failed: ${error.message}` };
  }

  console.log(
    `[insertPendingTikTokPull] Inserted pending pull for publish_id: ${input.publish_id}`
  );
  return { success: true };
}

/**
 * Increments the attempt count and updates last_polled_at for a pending
 * TikTok pull. Called on each poll iteration before the status fetch.
 *
 * Returns: { success, message }.
 * Persists: attempt_count + 1, last_polled_at=now().
 */
export async function incrementTikTokPullAttemptCount(
  publish_id: string
): Promise<
  { success: true; message: string } | { success: false; message: string }
> {
  // One statement: the database adds 1 to the stored count, so two
  // concurrent polls of one publish_id cannot lose an increment.
  const { data: updatedRows, error } = await runQuery(
    db
      .update(pending_tiktok_pulls)
      .set({
        attempt_count: sql`${pending_tiktok_pulls.attempt_count} + 1`,
        last_polled_at: new Date().toISOString(),
      })
      .where(eq(pending_tiktok_pulls.publish_id, publish_id))
      .returning({ attempt_count: pending_tiktok_pulls.attempt_count }),
  );

  if (error) {
    console.error(
      "[incrementTikTokPullAttemptCount] Update failed:",
      error.message
    );
    return { success: false, message: `Update failed: ${error.message}` };
  }

  const updatedPull = updatedRows[0];
  if (!updatedPull) {
    console.error(
      `[incrementTikTokPullAttemptCount] No pending pull for publish_id ${publish_id}`
    );
    return {
      success: false,
      message: `No pending pull for publish_id ${publish_id}`,
    };
  }

  return {
    success: true,
    message: `Attempt count: ${updatedPull.attempt_count}`,
  };
}

/**
 * Fetches a pending TikTok pull row by publish_id.
 * Returns success: false with a descriptive message if not found.
 *
 * Returns: { success, pull } or { success: false, message }.
 * Persists: nothing (read-only).
 */
export async function findPendingTikTokPullByPublishId(
  publish_id: string
): Promise<
  | { success: true; pull: PendingTikTokPull }
  | { success: false; message: string }
> {
  const { data: pullRows, error } = await runQuery(
    db
      .select()
      .from(pending_tiktok_pulls)
      .where(eq(pending_tiktok_pulls.publish_id, publish_id))
      .limit(1),
  );

  if (error) {
    console.error(
      "[findPendingTikTokPullByPublishId] Query failed:",
      error.message
    );
    return { success: false, message: `Query failed: ${error.message}` };
  }

  const pull = pullRows[0];
  if (!pull) {
    return {
      success: false,
      message: `No pending pull found for publish_id: ${publish_id}`,
    };
  }

  return { success: true, pull };
}

/**
 * Counts the number of pending TikTok pulls for a given media storage
 * path. Used by the cleanup gate to determine if a file is safe to
 * delete.
 *
 * Returns: { success, count } or { success: false, message }.
 * Persists: nothing (read-only).
 */
export async function countPendingTikTokPullsForMediaPath(
  media_storage_path: string
): Promise<
  { success: true; count: number } | { success: false; message: string }
> {
  const { data: count, error } = await runQuery(
    db.$count(
      pending_tiktok_pulls,
      and(
        eq(pending_tiktok_pulls.media_storage_path, media_storage_path),
        eq(pending_tiktok_pulls.status, "pending"),
      ),
    ),
  );

  if (error) {
    console.error(
      "[countPendingTikTokPullsForMediaPath] Query failed:",
      error.message
    );
    return { success: false, message: `Query failed: ${error.message}` };
  }

  return { success: true, count };
}
