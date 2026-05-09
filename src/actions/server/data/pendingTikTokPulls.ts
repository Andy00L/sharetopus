import "server-only";
import { adminSupabase } from "@/actions/api/adminSupabase";
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
}): Promise<{ success: true } | { success: false; message: string }> {
  const { error } = await adminSupabase.from("pending_tiktok_pulls").insert({
    publish_id: input.publish_id,
    principal_id: input.principal_id,
    social_account_id: input.social_account_id,
    scheduled_post_id: input.scheduled_post_id ?? null,
    content_history_id: input.content_history_id ?? null,
    media_storage_path: input.media_storage_path,
    status: "pending",
    attempt_count: 0,
  });

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
 * Updates a pending TikTok pull to completed status. Called when TikTok
 * reports PUBLISH_COMPLETE.
 *
 * Returns: { success, message }.
 * Persists: status='completed', finalized_at=now() on the row.
 */
export async function finalizeTikTokPullAsCompleted(
  publish_id: string
): Promise<
  { success: true; message: string } | { success: false; message: string }
> {
  const { error } = await adminSupabase
    .from("pending_tiktok_pulls")
    .update({
      status: "completed" as const,
      finalized_at: new Date().toISOString(),
    })
    .eq("publish_id", publish_id);

  if (error) {
    console.error(
      "[finalizeTikTokPullAsCompleted] Update failed:",
      error.message
    );
    return { success: false, message: `Update failed: ${error.message}` };
  }

  console.log(
    `[finalizeTikTokPullAsCompleted] Marked completed: ${publish_id}`
  );
  return { success: true, message: "Marked completed" };
}

/**
 * Updates a pending TikTok pull to failed status with a reason. Called
 * when TikTok reports a terminal failure or when polling times out.
 *
 * Returns: { success, message }.
 * Persists: status='failed', failure_reason, finalized_at=now().
 */
export async function finalizeTikTokPullAsFailed(
  publish_id: string,
  failure_reason: string
): Promise<
  { success: true; message: string } | { success: false; message: string }
> {
  const { error } = await adminSupabase
    .from("pending_tiktok_pulls")
    .update({
      status: "failed" as const,
      failure_reason,
      finalized_at: new Date().toISOString(),
    })
    .eq("publish_id", publish_id);

  if (error) {
    console.error(
      "[finalizeTikTokPullAsFailed] Update failed:",
      error.message
    );
    return { success: false, message: `Update failed: ${error.message}` };
  }

  console.log(
    `[finalizeTikTokPullAsFailed] Marked failed: ${publish_id}, reason: ${failure_reason}`
  );
  return { success: true, message: "Marked failed" };
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
  // Supabase JS client does not support SQL expressions like
  // attempt_count + 1 in .update(). Fetch current, increment, update.
  const { data: current, error: fetchErr } = await adminSupabase
    .from("pending_tiktok_pulls")
    .select("attempt_count")
    .eq("publish_id", publish_id)
    .single();

  if (fetchErr) {
    console.error(
      "[incrementTikTokPullAttemptCount] Fetch failed:",
      fetchErr.message
    );
    return { success: false, message: `Fetch failed: ${fetchErr.message}` };
  }

  const newCount = (current?.attempt_count ?? 0) + 1;

  const { error } = await adminSupabase
    .from("pending_tiktok_pulls")
    .update({
      attempt_count: newCount,
      last_polled_at: new Date().toISOString(),
    })
    .eq("publish_id", publish_id);

  if (error) {
    console.error(
      "[incrementTikTokPullAttemptCount] Update failed:",
      error.message
    );
    return { success: false, message: `Update failed: ${error.message}` };
  }

  return { success: true, message: `Attempt count: ${newCount}` };
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
  const { data, error } = await adminSupabase
    .from("pending_tiktok_pulls")
    .select("*")
    .eq("publish_id", publish_id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return {
        success: false,
        message: `No pending pull found for publish_id: ${publish_id}`,
      };
    }
    console.error(
      "[findPendingTikTokPullByPublishId] Query failed:",
      error.message
    );
    return { success: false, message: `Query failed: ${error.message}` };
  }

  return { success: true, pull: data };
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
  const { count, error } = await adminSupabase
    .from("pending_tiktok_pulls")
    .select("publish_id", { count: "exact", head: true })
    .eq("media_storage_path", media_storage_path)
    .eq("status", "pending");

  if (error) {
    console.error(
      "[countPendingTikTokPullsForMediaPath] Query failed:",
      error.message
    );
    return { success: false, message: `Query failed: ${error.message}` };
  }

  return { success: true, count: count ?? 0 };
}
