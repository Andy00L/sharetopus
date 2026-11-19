import "server-only";
import { eq } from "drizzle-orm";

import { fetchAccountForPublish } from "@/actions/server/data/fetchAccountForPublish";
import { db, runQuery } from "@/db/client";
import { content_history, type Json } from "@/db/schema";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { inngest } from "@/inngest/client";
import { isJsonObject } from "@/lib/utils/jsonObject";

// Call it inside the step that uses the token; never return the token
// from a step, because Inngest stores step results.
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

  const existingExtra = isJsonObject(current.extra) ? current.extra : {};

  const mergedExtra: Json = {
    ...existingExtra,
    failure_reason: reason,
    failed_at: new Date().toISOString(),
  };

  const { error: updateErr } = await runQuery(
    db
      .update(content_history)
      .set({
        status: "failed",
        extra: mergedExtra,
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
