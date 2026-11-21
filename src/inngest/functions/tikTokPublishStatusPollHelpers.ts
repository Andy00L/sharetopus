import "server-only";

import { fetchAccountForPublish } from "@/actions/server/data/fetchAccountForPublish";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { inngest } from "@/inngest/client";

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
