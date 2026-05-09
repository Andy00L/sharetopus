import "server-only";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { inngest } from "@/inngest/client";
import type { Json } from "@/lib/types/database.types";

/**
 * Resolves a fresh TikTok access token for a social account.
 * Fetches the account row, then calls ensureValidToken to handle
 * refresh if needed.
 *
 * Returns: { success, token } or { success: false, message }.
 */
export async function resolveTikTokAccessTokenForAccount(
  social_account_id: string
): Promise<
  { success: true; token: string } | { success: false; message: string }
> {
  const { data: account, error } = await adminSupabase
    .from("social_accounts")
    .select("*")
    .eq("id", social_account_id)
    .is("deleted_at", null)
    .single();

  if (error) {
    console.error(
      "[resolveTikTokAccessTokenForAccount] Account fetch failed:",
      error.message
    );
    return {
      success: false,
      message: `Account fetch failed: ${error.message}`,
    };
  }
  if (!account) {
    return {
      success: false,
      message: `Social account not found: ${social_account_id}`,
    };
  }

  const tokenResult = await ensureValidToken(account);

  if (!tokenResult.success || !tokenResult.token) {
    return {
      success: false,
      message:
        tokenResult.error ?? "Token resolution returned no token",
    };
  }

  return { success: true, token: tokenResult.token };
}

/**
 * Updates a content_history row to status='failed' and merges the
 * failure reason into the extra jsonb column. Preserves existing
 * extra fields via application-level merge.
 *
 * No-ops if content_history_id is null (post was never recorded).
 *
 * Returns: { success, message }.
 * Persists: content_history.status='failed', extra += failure info.
 */
export async function updateContentHistoryStatusToFailed(
  content_history_id: string | null,
  reason: string
): Promise<
  { success: true; message: string } | { success: false; message: string }
> {
  if (!content_history_id) {
    console.log(
      "[updateContentHistoryStatusToFailed] No content_history_id, skipping"
    );
    return { success: true, message: "Skipped (no content_history_id)" };
  }

  // Fetch current extra to merge
  const { data: current, error: fetchErr } = await adminSupabase
    .from("content_history")
    .select("extra")
    .eq("id", content_history_id)
    .single();

  if (fetchErr) {
    console.error(
      "[updateContentHistoryStatusToFailed] Fetch failed:",
      fetchErr.message
    );
    return {
      success: false,
      message: `Fetch content_history failed: ${fetchErr.message}`,
    };
  }

  // Merge failure info into existing extra
  const existingExtra =
    current?.extra && typeof current.extra === "object" && !Array.isArray(current.extra)
      ? (current.extra as Record<string, Json>)
      : {};

  const mergedExtra: Record<string, Json> = {
    ...existingExtra,
    failure_reason: reason,
    failed_at: new Date().toISOString(),
  };

  const { error: updateErr } = await adminSupabase
    .from("content_history")
    .update({
      status: "failed",
      extra: mergedExtra as Json,
    })
    .eq("id", content_history_id);

  if (updateErr) {
    console.error(
      "[updateContentHistoryStatusToFailed] Update failed:",
      updateErr.message
    );
    return {
      success: false,
      message: `Update content_history failed: ${updateErr.message}`,
    };
  }

  console.log(
    `[updateContentHistoryStatusToFailed] Marked content_history ${content_history_id} as failed`
  );
  return { success: true, message: "Content history marked failed" };
}

/**
 * Dispatches a tiktok.publish.poll Inngest event to trigger the
 * polling worker for a specific publish_id.
 *
 * Returns: { success, message }.
 * Persists: one Inngest event.
 */
export async function dispatchTikTokPublishPollEvent(input: {
  publish_id: string;
  content_history_id: string | null;
  social_account_id: string;
}): Promise<
  { success: true; message: string } | { success: false; message: string }
> {
  try {
    await inngest.send({
      name: "tiktok.publish.poll",
      data: {
        publish_id: input.publish_id,
        content_history_id: input.content_history_id,
        social_account_id: input.social_account_id,
      },
    });

    console.log(
      `[dispatchTikTokPublishPollEvent] Dispatched poll event for publish_id: ${input.publish_id}`
    );
    return { success: true, message: "Poll event dispatched" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      "[dispatchTikTokPublishPollEvent] Dispatch failed:",
      message
    );
    return { success: false, message: `Dispatch failed: ${message}` };
  }
}
