import "server-only";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { findPendingTikTokPullByPublishId } from "@/actions/server/data/pendingTikTokPulls";
import { updateContentHistoryStatusToFailed } from "@/inngest/functions/tikTokPublishStatusPollHelpers";
import { cleanupMediaIfUnreferenced } from "@/inngest/functions/processSinglePostHelpers";

type FinalizeInput = {
  source: "poll" | "webhook";
  outcome: "completed" | "failed";
  tiktok_post_id?: string | null;
  fail_reason?: string;
};

type FinalizeResult =
  | { success: true; message: string; alreadyFinalized?: boolean }
  | { success: false; message: string };

/**
 * Builds the canonical TikTok deep link or returns null when
 * required pieces are missing. Path segment derived from publish_id
 * prefix: p_pub_ = photo, v_pub_ = video, unknown = null.
 */
function buildTikTokDeepLink(input: {
  creator_username: string | null;
  tiktok_post_id: string | null;
  publish_id: string;
}): string | null {
  if (!input.creator_username || !input.tiktok_post_id) return null;

  let segment: "photo" | "video";
  if (input.publish_id.startsWith("p_pub_")) {
    segment = "photo";
  } else if (input.publish_id.startsWith("v_pub_")) {
    segment = "video";
  } else {
    console.warn(
      `[buildTikTokDeepLink] Unknown publish_id prefix: ${input.publish_id}`,
    );
    return null;
  }

  return `https://www.tiktok.com/@${input.creator_username}/${segment}/${input.tiktok_post_id}`;
}

/**
 * Single finalization entry point for TikTok posts. Called by both
 * the polling worker and the webhook worker. Idempotent: if the
 * pending_tiktok_pulls row is already non-pending, returns
 * alreadyFinalized=true and (when applicable) backfills tiktok_post_id
 * and content_history.media_url if the new caller has data the prior
 * one lacked.
 *
 * Persists:
 *   - pending_tiktok_pulls: status, tiktok_post_id, failure_reason,
 *     finalized_at
 *   - content_history: media_url (success path, when deep link buildable)
 *   - content_history: status='failed' + extra (fail path)
 * Cleans up:
 *   - storage media if unreferenced
 */
export async function finalizeTikTokPostByPublishId(
  publish_id: string,
  opts: FinalizeInput,
): Promise<FinalizeResult> {
  const pull = await findPendingTikTokPullByPublishId(publish_id);
  if (!pull.success) {
    // Not our publish_id. Webhook for a post we did not create, or
    // already deleted row. Safe no-op.
    console.log(
      `[finalizeTikTokPostByPublishId] No pull row for ${publish_id} (source=${opts.source}), ignoring`,
    );
    return { success: true, message: "No matching pull row, ignored" };
  }

  const row = pull.pull;

  // Already finalized path. If webhook brought new data poll did not
  // have, backfill the missing piece.
  if (row.status !== "pending") {
    const shouldBackfillPostId =
      opts.tiktok_post_id && !row.tiktok_post_id && opts.outcome === "completed";

    if (shouldBackfillPostId) {
      const { error: updErr } = await adminSupabase
        .from("pending_tiktok_pulls")
        .update({ tiktok_post_id: opts.tiktok_post_id })
        .eq("publish_id", publish_id);

      if (updErr) {
        console.error(
          "[finalizeTikTokPostByPublishId] Backfill post_id failed:",
          updErr.message,
        );
        return {
          success: false,
          message: `Backfill failed: ${updErr.message}`,
        };
      }

      const deepLink = buildTikTokDeepLink({
        creator_username: row.creator_username,
        tiktok_post_id: opts.tiktok_post_id ?? null,
        publish_id,
      });

      if (deepLink && row.content_history_id) {
        const { error: histErr } = await adminSupabase
          .from("content_history")
          .update({ media_url: deepLink })
          .eq("id", row.content_history_id);

        if (histErr) {
          console.error(
            "[finalizeTikTokPostByPublishId] Backfill media_url failed:",
            histErr.message,
          );
          // Non-fatal: post_id is still saved.
        } else {
          console.log(
            `[finalizeTikTokPostByPublishId] Backfilled media_url for ${publish_id}`,
          );
        }
      }
    }

    return {
      success: true,
      message: `Already finalized (status=${row.status})`,
      alreadyFinalized: true,
    };
  }

  // First finalization path.
  if (opts.outcome === "completed") {
    const { error: updErr } = await adminSupabase
      .from("pending_tiktok_pulls")
      .update({
        status: "completed" as const,
        tiktok_post_id: opts.tiktok_post_id ?? null,
        finalized_at: new Date().toISOString(),
      })
      .eq("publish_id", publish_id)
      .eq("status", "pending");

    if (updErr) {
      console.error(
        "[finalizeTikTokPostByPublishId] Mark completed failed:",
        updErr.message,
      );
      return { success: false, message: `Update failed: ${updErr.message}` };
    }

    const deepLink = buildTikTokDeepLink({
      creator_username: row.creator_username,
      tiktok_post_id: opts.tiktok_post_id ?? null,
      publish_id,
    });

    if (deepLink && row.content_history_id) {
      const { error: histErr } = await adminSupabase
        .from("content_history")
        .update({ media_url: deepLink })
        .eq("id", row.content_history_id);

      if (histErr) {
        console.error(
          "[finalizeTikTokPostByPublishId] Update media_url failed:",
          histErr.message,
        );
        // Non-fatal.
      } else {
        console.log(
          `[finalizeTikTokPostByPublishId] Set media_url for ${publish_id}: ${deepLink}`,
        );
      }
    }

    const cleanup = await cleanupMediaIfUnreferenced(
      row.media_storage_path,
      row.principal_id,
    );
    if (!cleanup.deleted) {
      console.log(
        `[finalizeTikTokPostByPublishId] Media cleanup skipped: ${cleanup.message}`,
      );
    }

    console.log(
      `[finalizeTikTokPostByPublishId] Completed ${publish_id} (source=${opts.source}, post_id=${opts.tiktok_post_id ?? "null"})`,
    );
    return { success: true, message: "Finalized as completed" };
  }

  // opts.outcome === "failed"
  const failReason = opts.fail_reason ?? "Unknown failure";

  const { error: updErr } = await adminSupabase
    .from("pending_tiktok_pulls")
    .update({
      status: "failed" as const,
      failure_reason: failReason,
      finalized_at: new Date().toISOString(),
    })
    .eq("publish_id", publish_id)
    .eq("status", "pending");

  if (updErr) {
    console.error(
      "[finalizeTikTokPostByPublishId] Mark failed failed:",
      updErr.message,
    );
    return { success: false, message: `Update failed: ${updErr.message}` };
  }

  const histRes = await updateContentHistoryStatusToFailed(
    row.content_history_id,
    failReason,
  );
  if (!histRes.success) {
    console.error(
      "[finalizeTikTokPostByPublishId] content_history update failed:",
      histRes.message,
    );
    // Non-fatal: pull is still marked failed.
  }

  const cleanup = await cleanupMediaIfUnreferenced(
    row.media_storage_path,
    row.principal_id,
  );
  if (!cleanup.deleted) {
    console.log(
      `[finalizeTikTokPostByPublishId] Media cleanup skipped: ${cleanup.message}`,
    );
  }

  console.log(
    `[finalizeTikTokPostByPublishId] Failed ${publish_id} (source=${opts.source}, reason=${failReason})`,
  );
  return { success: true, message: "Finalized as failed" };
}
