import { and, eq, lt } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { pending_direct_posts } from "@/db/schema";
import type { Platform } from "@/db/schema";
import "server-only";

export type PendingDirectPostInput = {
  event_id: string;
  batch_id: string;
  principal_id: string;
  social_account_id: string;
  platform: Platform;
  media_storage_path: string;
  idempotency_key?: string | null;
};

export type InsertPendingDirectPostsResult =
  | { success: true; message: string; insertedCount: number }
  | { success: false; message: string };

/**
 * Bulk insert lock rows BEFORE inngest.send. Caller must abort dispatch
 * if this returns success: false.
 *
 * Idempotency: event_id is the PK. Re-inserting the same event_id will
 * fail with a 23505 unique violation. Treat this as success (lock already
 * exists, dispatch can proceed).
 */
export async function insertPendingDirectPosts(
  rows: PendingDirectPostInput[],
): Promise<InsertPendingDirectPostsResult> {
  if (rows.length === 0) {
    return { success: true, message: "No rows to insert", insertedCount: 0 };
  }

  const insertRows = rows.map((lockInput) => ({
    event_id: lockInput.event_id,
    batch_id: lockInput.batch_id,
    principal_id: lockInput.principal_id,
    social_account_id: lockInput.social_account_id,
    platform: lockInput.platform,
    media_storage_path: lockInput.media_storage_path,
    status: "processing" as const,
    idempotency_key: lockInput.idempotency_key ?? null,
  }));

  // One multi-row INSERT: all rows land or none do.
  const { error } = await runQuery(
    db.insert(pending_direct_posts).values(insertRows),
  );

  if (error) {
    // 23505 = unique_violation on either event_id PK (replay) or the
    // (principal_id, idempotency_key) unique constraint
    // pending_direct_posts_principal_idem_uq (retry).
    // Both mean "already dispatched, do not re-dispatch."
    if (error.code === "23505") {
      console.warn(
        "[insertPendingDirectPosts] Unique violation (event_id PK or idempotency_key), treating as idempotent:",
        error.message,
      );
      return {
        success: true,
        message: "Already inserted (idempotent)",
        insertedCount: rows.length,
      };
    }
    console.error("[insertPendingDirectPosts] Insert failed:", error.message);
    return { success: false, message: `Insert failed: ${error.message}` };
  }

  console.log(`[insertPendingDirectPosts] Inserted ${rows.length} lock row(s)`);
  return { success: true, message: "Inserted", insertedCount: rows.length };
}

/**
 * Marks a row terminal. Idempotent: only acts if status is currently
 * 'processing'. Re-invocation after terminal is a no-op.
 *
 * status: "completed" on worker success, "failed" on worker failure.
 * failureReason: short string, max 1000 chars, only when status="failed".
 */
export async function finalizePendingDirectPost(
  eventId: string,
  status: "completed" | "failed",
  failureReason: string | null,
): Promise<{ success: boolean; message: string; updated: boolean }> {
  const now = new Date().toISOString();

  const { data: updatedRows, error } = await runQuery(
    db
      .update(pending_direct_posts)
      .set({
        status,
        finished_at: now,
        failure_reason: failureReason,
      })
      .where(
        and(
          eq(pending_direct_posts.event_id, eventId),
          eq(pending_direct_posts.status, "processing"),
        ),
      )
      .returning({ event_id: pending_direct_posts.event_id }),
  );

  if (error) {
    console.error("[finalizePendingDirectPost] Update failed:", error.message);
    return {
      success: false,
      message: `Update failed: ${error.message}`,
      updated: false,
    };
  }

  const updated = updatedRows.length > 0;
  if (!updated) {
    console.log(`[finalizePendingDirectPost] Already finalized: ${eventId}`);
  } else {
    console.log(`[finalizePendingDirectPost] Marked ${status}: ${eventId}`);
  }

  return {
    success: true,
    message: updated ? `Marked ${status}` : "Already finalized",
    updated,
  };
}

/**
 * Counts active rows for a media path. Used by the cleanup safety check.
 * Returns success: false on DB error so the caller can preserve the file
 * conservatively (mirrors countPendingTikTokPullsForMediaPath behavior).
 */
export async function countPendingDirectPostsForMediaPath(
  mediaPath: string,
): Promise<
  { success: true; count: number } | { success: false; message: string }
> {
  const { data: count, error } = await runQuery(
    db.$count(
      pending_direct_posts,
      and(
        eq(pending_direct_posts.media_storage_path, mediaPath),
        eq(pending_direct_posts.status, "processing"),
      ),
    ),
  );

  if (error) {
    console.error(
      "[countPendingDirectPostsForMediaPath] Query failed:",
      error.message,
    );
    return { success: false, message: `Query failed: ${error.message}` };
  }

  return { success: true, count };
}

/**
 * Marks rows stuck in 'processing' older than cutoffIso as 'failed'.
 * Used by the sweeper Inngest cron. Returns the count of rows updated.
 */
export async function sweepStuckPendingDirectPosts(
  cutoffIso: string,
): Promise<
  { success: true; sweptCount: number } | { success: false; message: string }
> {
  const now = new Date().toISOString();

  const { data: sweptRows, error } = await runQuery(
    db
      .update(pending_direct_posts)
      .set({
        status: "failed" as const,
        finished_at: now,
        failure_reason: "stale_worker_swept",
      })
      .where(
        and(
          eq(pending_direct_posts.status, "processing"),
          lt(pending_direct_posts.created_at, cutoffIso),
        ),
      )
      .returning({ event_id: pending_direct_posts.event_id }),
  );

  if (error) {
    console.error(
      "[sweepStuckPendingDirectPosts] Update failed:",
      error.message,
    );
    return { success: false, message: `Sweep failed: ${error.message}` };
  }

  return { success: true, sweptCount: sweptRows.length };
}
