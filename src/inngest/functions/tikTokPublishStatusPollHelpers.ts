import "server-only";
import { eq } from "drizzle-orm";

import { fetchAccountForPublish } from "@/actions/server/data/fetchAccountForPublish";
import { db, runQuery } from "@/db/client";
import { content_history, type Json } from "@/db/schema";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { inngest } from "@/inngest/client";

/**
 * Resolves a fresh TikTok access token for a social account.
 * Fetches the account row, then calls ensureValidToken to handle
 * refresh if needed. Call it inside the step that uses the token; never
 * return the token from a step (Inngest stores step results).
 *
 * Returns: { success, token } or { success: false, message }.
 */
export async function resolveTikTokAccessTokenForAccount(
  social_account_id: string
): Promise<
  { success: true; token: string } | { success: false; message: string }
> {
  const fetched = await fetchAccountForPublish(social_account_id);
  if (!fetched.success) {
    return { success: false, message: fetched.message };
  }

  const tokenResult = await ensureValidToken(fetched.account);

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
  const { data: currentRows, error: fetchErr } = await runQuery(
    db
      .select({ extra: content_history.extra })
      .from(content_history)
      .where(eq(content_history.id, content_history_id))
      .limit(1),
  );

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

  const current = currentRows[0];
  if (!current) {
    console.error(
      `[updateContentHistoryStatusToFailed] Fetch failed: no content_history row ${content_history_id}`
    );
    return {
      success: false,
      message: `Fetch content_history failed: no row for id ${content_history_id}`,
    };
  }

  // Merge failure info into existing extra
  const existingExtra =
    current.extra && typeof current.extra === "object" && !Array.isArray(current.extra)
      ? (current.extra as Record<string, Json>)
      : {};

  const mergedExtra: Record<string, Json> = {
    ...existingExtra,
    failure_reason: reason,
    failed_at: new Date().toISOString(),
  };

  const { error: updateErr } = await runQuery(
    db
      .update(content_history)
      .set({
        status: "failed",
        extra: mergedExtra as Json,
      })
      .where(eq(content_history.id, content_history_id)),
  );

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
