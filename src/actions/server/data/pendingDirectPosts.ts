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
  | {
      success: true;
      message: string;
      insertedCount: number;
      /** The event_ids whose lock row this call wrote. Only these may be sent to Inngest. */
      insertedEventIds: string[];
    }
  | { success: false; message: string };

/**
 * Bulk insert lock rows BEFORE inngest.send. Caller must abort dispatch
 * if this returns success: false.
 *
 * Idempotency: a row whose event_id (PK) or (principal_id, idempotency_key)
 * (pending_direct_posts_principal_idem_uq) already exists is skipped, and
 * insertedEventIds lists only the rows written. Two concurrent dispatches
 * of one batch both pass the caller's pre-check; only the one whose lock
 * rows land may send, or the post goes out twice.
 */
export async function insertPendingDirectPosts(
  rows: PendingDirectPostInput[],
): Promise<InsertPendingDirectPostsResult> {
  if (rows.length === 0) {
    return {
      success: true,
      message: "No rows to insert",
      insertedCount: 0,
      insertedEventIds: [],
    };
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

  const { data: insertedRows, error } = await runQuery(
    db
      .insert(pending_direct_posts)
      .values(insertRows)
      .onConflictDoNothing()
      .returning({ event_id: pending_direct_posts.event_id }),
  );

  if (error) {
    console.error("[insertPendingDirectPosts] Insert failed:", error.message);
    return { success: false, message: `Insert failed: ${error.message}` };
  }

  const insertedEventIds = insertedRows.map((insertedRow) => insertedRow.event_id);
  const skippedCount = rows.length - insertedEventIds.length;
  if (skippedCount > 0) {
    console.warn(
      `[insertPendingDirectPosts] ${skippedCount} lock row(s) already existed (event_id or idempotency_key), not re-dispatched`,
    );
  }
  console.log(`[insertPendingDirectPosts] Inserted ${insertedEventIds.length} lock row(s)`);
  return {
    success: true,
    message: skippedCount > 0 ? "Inserted, duplicates skipped" : "Inserted",
    insertedCount: insertedEventIds.length,
    insertedEventIds,
  };
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
