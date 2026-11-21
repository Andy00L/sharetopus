import "server-only";
import { eq, sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { pending_tiktok_pulls } from "@/db/schema";
import type { PendingTikTokPull } from "@/lib/types/dbTypes";

export async function insertPendingTikTokPull(input: {
  publish_id: string;
  principal_id: string;
  social_account_id: string;
  scheduled_post_id: string | null;
  dispatch_id: string | null;
  content_history_id: string | null;
  media_storage_path: string;
  creator_username: string | null;
}): Promise<{ success: true } | { success: false; message: string }> {
  const { error } = await runQuery(
    db.insert(pending_tiktok_pulls).values({
      publish_id: input.publish_id,
      principal_id: input.principal_id,
      social_account_id: input.social_account_id,
      scheduled_post_id: input.scheduled_post_id,
      dispatch_id: input.dispatch_id,
      content_history_id: input.content_history_id,
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

export async function incrementTikTokPullAttemptCount(
  publish_id: string
): Promise<
  { success: true; message: string } | { success: false; message: string }
> {
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

export type PendingTikTokPullLookup =
  | { success: true; pull: PendingTikTokPull }
  | { success: false; reason: "not_found" | "lookup_failed"; message: string };

export async function findPendingTikTokPullByPublishId(
  publish_id: string
): Promise<PendingTikTokPullLookup> {
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
    return {
      success: false,
      reason: "lookup_failed",
      message: `Query failed: ${error.message}`,
    };
  }

  const pull = pullRows[0];
  if (!pull) {
    return {
      success: false,
      reason: "not_found",
      message: `No pending pull found for publish_id: ${publish_id}`,
    };
  }

  return { success: true, pull };
}
