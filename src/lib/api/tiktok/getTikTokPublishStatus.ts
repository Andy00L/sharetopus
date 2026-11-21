import "server-only";
import { z } from "zod";

import { PLATFORM_API_TIMEOUT_MS } from "@/lib/api/_shared/platformFetchTimeouts";
import { describeNetworkError } from "@/lib/net/describeNetworkError";
import { parseJsonObject } from "@/lib/platforms/providers/_shared/providerFetch";

// https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status
const PublishStatusResponseSchema = z.object({
  data: z
    .object({
      status: z.string().nullish(),
      fail_reason: z.string().nullish(),
      // publicaly_available_post_id is documented as list<int64>.
      publicaly_available_post_id: z
        .array(z.union([z.string(), z.number()]))
        .nullish(),
    })
    .nullish(),
  error: z.object({ message: z.string().nullish() }).nullish(),
});

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
        signal: AbortSignal.timeout(PLATFORM_API_TIMEOUT_MS),
      }
    );

    const parsedBody = PublishStatusResponseSchema.safeParse(
      parseJsonObject(await response.text()),
    );
    if (!parsedBody.success) {
      console.error(
        `[getTikTokPublishStatus] Response body had an unexpected shape (HTTP ${response.status})`,
      );
      return {
        success: false,
        message: `TikTok API error: unexpected response (HTTP ${response.status})`,
      };
    }
    const body = parsedBody.data;

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
      const publicPostId = body.data?.publicaly_available_post_id?.[0];
      return {
        success: true,
        terminal: true,
        kind: "completed",
        raw_status: status,
        tiktok_post_id:
          publicPostId === undefined ? undefined : String(publicPostId),
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

    console.log(`[getTikTokPublishStatus] In progress: ${status}`);
    return {
      success: true,
      terminal: false,
      kind: "in_progress",
      raw_status: status,
    };
  } catch (requestError) {
    const message = describeNetworkError(requestError);
    console.error("[getTikTokPublishStatus] Network error:", message);
    return { success: false, message: `Network error: ${message}` };
  }
}
