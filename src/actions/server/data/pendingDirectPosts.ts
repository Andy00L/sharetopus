import "server-only";
import { adminSupabase } from "@/actions/api/adminSupabase";

export type PendingDirectPostInput = {
  event_id: string;
  batch_id: string;
  principal_id: string;
  social_account_id: string;
  platform: "linkedin" | "pinterest" | "tiktok" | "instagram";
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
  rows: PendingDirectPostInput[]
): Promise<InsertPendingDirectPostsResult> {
  if (rows.length === 0) {
    return { success: true, message: "No rows to insert", insertedCount: 0 };
  }

  const insertRows = rows.map((r) => ({
    event_id: r.event_id,
    batch_id: r.batch_id,
    principal_id: r.principal_id,
    social_account_id: r.social_account_id,
    platform: r.platform,
    media_storage_path: r.media_storage_path,
    status: "processing" as const,
    idempotency_key: r.idempotency_key ?? null,
  }));

  const { error } = await adminSupabase
    .from("pending_direct_posts")
    .insert(insertRows);

  if (error) {
    // 23505 = unique_violation on either event_id PK (replay) or
    // (principal_id, idempotency_key) partial unique index (retry).
    // Both mean "already dispatched, do not re-dispatch."
    if (error.code === "23505") {
      console.warn(
        "[insertPendingDirectPosts] Unique violation (event_id PK or idempotency_key), treating as idempotent:",
        error.message
      );
      return {
        success: true,
        message: "Already inserted (idempotent)",
        insertedCount: rows.length,
      };
    }
    console.error(
      "[insertPendingDirectPosts] Insert failed:",
      error.message
    );
    return { success: false, message: `Insert failed: ${error.message}` };
  }

  console.log(
    `[insertPendingDirectPosts] Inserted ${rows.length} lock row(s)`
  );
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
  failureReason: string | null
): Promise<{ success: boolean; message: string; updated: boolean }> {
  const now = new Date().toISOString();

  const { data, error } = await adminSupabase
    .from("pending_direct_posts")
    .update({
      status,
      finished_at: now,
      failure_reason: failureReason,
    })
    .eq("event_id", eventId)
    .eq("status", "processing")
    .select("event_id");

  if (error) {
    console.error(
      "[finalizePendingDirectPost] Update failed:",
      error.message
    );
    return {
      success: false,
      message: `Update failed: ${error.message}`,
      updated: false,
    };
  }

  const updated = !!(data && data.length > 0);
  if (!updated) {
    console.log(
      `[finalizePendingDirectPost] Already finalized: ${eventId}`
    );
  } else {
    console.log(
      `[finalizePendingDirectPost] Marked ${status}: ${eventId}`
    );
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
  mediaPath: string
): Promise<{ success: true; count: number } | { success: false; message: string }> {
  const { count, error } = await adminSupabase
    .from("pending_direct_posts")
    .select("event_id", { count: "exact", head: true })
    .eq("media_storage_path", mediaPath)
    .eq("status", "processing");

  if (error) {
    console.error(
      "[countPendingDirectPostsForMediaPath] Query failed:",
      error.message
    );
    return { success: false, message: `Query failed: ${error.message}` };
  }

  return { success: true, count: count ?? 0 };
}

/**
 * Marks rows stuck in 'processing' older than cutoffIso as 'failed'.
 * Used by the sweeper Inngest cron. Returns the count of rows updated.
 */
export async function sweepStuckPendingDirectPosts(
  cutoffIso: string
): Promise<{ success: true; sweptCount: number } | { success: false; message: string }> {
  const now = new Date().toISOString();

  const { data, error } = await adminSupabase
    .from("pending_direct_posts")
    .update({
      status: "failed" as const,
      finished_at: now,
      failure_reason: "stale_worker_swept",
    })
    .eq("status", "processing")
    .lt("created_at", cutoffIso)
    .select("event_id");

  if (error) {
    console.error(
      "[sweepStuckPendingDirectPosts] Update failed:",
      error.message
    );
    return { success: false, message: `Sweep failed: ${error.message}` };
  }

  return { success: true, sweptCount: data?.length ?? 0 };
}
