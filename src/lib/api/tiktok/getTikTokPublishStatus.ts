import fetch from "node-fetch";
import "server-only";

// Terminal failure status values from TikTok Content Posting API.
// Reference: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
const TERMINAL_FAILURE_STATUSES = new Set([
  "FAILED",
  "PROCESSING_DOWNLOAD_FAILED",
  "PROCESSING_UPLOAD_FAILED",
  "SEND_TO_USER_INBOX_FAILED",
]);

const TERMINAL_SUCCESS_STATUSES = new Set(["PUBLISH_COMPLETE"]);

export type TikTokPublishStatusResult =
  | {
      success: true;
      terminal: boolean;
      kind: "completed" | "failed" | "in_progress";
      raw_status: string;
      reason?: string;
      tiktok_post_id?: string;
    }
  | { success: false; message: string };

/**
 * Fetches the publish status of a TikTok post from the Content Posting
 * API's /v2/post/publish/status/fetch/ endpoint.
 *
 * After init returns a publish_id, TikTok pulls the media asynchronously.
 * This function checks whether that pull has completed, failed, or is
 * still in progress.
 *
 * Returns terminal: true when TikTok has reached a final state (success
 * or failure). Returns terminal: false when still processing.
 *
 * Does not throw. Returns { success: false, message } on network or
 * HTTP errors.
 */
export async function getTikTokPublishStatus(input: {
  publish_id: string;
  access_token: string;
}): Promise<TikTokPublishStatusResult> {
  const { publish_id, access_token } = input;

  try {
    const response = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({ publish_id }),
      }
    );

    // Read the body exactly once (FIX 17 convention).
    const body = (await response.json()) as {
      data?: {
        status?: string;
        fail_reason?: string;
        publicaly_available_post_id?: string[];
      };
      error?: {
        code?: string;
        message?: string;
        log_id?: string;
      };
    };

    if (!response.ok) {
      const errorMsg = body.error?.message ?? `HTTP ${response.status}`;
      console.error(
        `[getTikTokPublishStatus] Non-2xx response: ${response.status}`,
        body.error
      );
      return { success: false, message: `TikTok API error: ${errorMsg}` };
    }

    const status = body.data?.status ?? "";

    if (TERMINAL_SUCCESS_STATUSES.has(status)) {
      console.log(`[getTikTokPublishStatus] Terminal success: ${status}`);
      return {
        success: true,
        terminal: true,
        kind: "completed",
        raw_status: status,
        tiktok_post_id:
          body.data?.publicaly_available_post_id?.[0] ?? undefined,
      };
    }

    if (TERMINAL_FAILURE_STATUSES.has(status)) {
      const reason = body.data?.fail_reason ?? status;
      console.log(
        `[getTikTokPublishStatus] Terminal failure: ${status}, reason: ${reason}`
      );
      return {
        success: true,
        terminal: true,
        kind: "failed",
        raw_status: status,
        reason,
      };
    }

    // Non-terminal: PROCESSING_DOWNLOAD, PROCESSING_UPLOAD,
    // SEND_TO_USER_INBOX, or any other in-progress status.
    console.log(`[getTikTokPublishStatus] In progress: ${status}`);
    return {
      success: true,
      terminal: false,
      kind: "in_progress",
      raw_status: status,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[getTikTokPublishStatus] Network error:", message);
    return { success: false, message: `Network error: ${message}` };
  }
}
