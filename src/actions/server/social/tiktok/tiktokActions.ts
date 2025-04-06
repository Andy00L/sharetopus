// src/actions/tiktokActions.ts
"use server";
import { getValidTikTokToken } from "@/lib/api/tiktok/tiktokAuthHelper";
import { auth } from "@clerk/nextjs/server";

// Mark this file as containing Server Actions

// Interface for the initiation response
interface TikTokVideoInitResponse {
  data: {
    publish_id: string;
    upload_url: string;
  };
  error: {
    code: string;
    message: string;
    log_id: string;
  };
}

// Interface for the publish response
interface TikTokVideoPublishResponse {
  data: {
    share_id: string; // Or other relevant data on success
  };
  error: {
    code: string;
    message: string;
    log_id: string;
  };
}
// --- Define or import the type here too ---
type TikTokPrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "SELF_ONLY";
// Action to initiate video upload
export async function initiateTikTokVideoUpload(
  accountId: string // The DB ID of the social account
): Promise<{ upload_url: string; publish_id: string }> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("User not authenticated.");
  }

  try {
    const accessToken = await getValidTikTokToken(userId, accountId);

    const url = "https://open.tiktokapis.com/v2/post/publish/video/init/";
    const body = JSON.stringify({
      post_info: {
        // source can be VIDEO_SOURCE_FILE_UPLOAD or VIDEO_SOURCE_PULL_URL
        source: "VIDEO_SOURCE_FILE_UPLOAD",
      },
    });

    console.log("[TikTok Init] Initiating video upload...");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: body,
    });

    const data: TikTokVideoInitResponse = await response.json();
    console.log("[TikTok Init] Response:", JSON.stringify(data));

    if (data.error && data.error.code !== "ok") {
      throw new Error(
        `TikTok init failed (${data.error.code}): ${data.error.message}`
      );
    }
    if (!data.data?.upload_url || !data.data?.publish_id) {
      throw new Error("TikTok init response missing upload_url or publish_id.");
    }

    console.log("[TikTok Init] Success.");
    return {
      upload_url: data.data.upload_url,
      publish_id: data.data.publish_id,
    };
  } catch (error) {
    console.error("[TikTok Init] Error:", error);
    // Re-throw a generic error or the specific error
    throw new Error(
      `Failed to initiate TikTok upload: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

// Action to publish the video after upload
export async function publishTikTokVideo(
  accountId: string,
  publishId: string,
  title: string,
  privacyLevel: TikTokPrivacyLevel,
  disableComment: boolean,
  disableDuet: boolean,
  disableStitch: boolean
  // Add other options like brand content toggles, location ID etc. if needed
): Promise<{ share_id: string }> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("User not authenticated.");
  }

  try {
    const accessToken = await getValidTikTokToken(userId, accountId);

    const url = "https://open.tiktokapis.com/v2/post/publish/video/";
    const body = JSON.stringify({
      publish_id: publishId,
      post_info: {
        title: title,
        privacy_level: privacyLevel,
        disable_comment: disableComment,
        disable_duet: disableDuet,
        disable_stitch: disableStitch,
        // video_cover_timestamp_ms: 1000, // Optional: timestamp for cover frame
      },
    });

    console.log("[TikTok Publish] Publishing video with ID:", publishId);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        // Required header for publish endpoint
        "Idempotency-Key": `tiktok-publish-${publishId}-${Date.now()}`, // Generate a unique key
      },
      body: body,
    });

    const data: TikTokVideoPublishResponse = await response.json();
    console.log("[TikTok Publish] Response:", JSON.stringify(data));

    if (data.error && data.error.code !== "ok") {
      // Handle specific errors like "video_upload_inprogress" if needed
      throw new Error(
        `TikTok publish failed (${data.error.code}): ${data.error.message}`
      );
    }
    if (!data.data?.share_id) {
      // Success might not always return share_id immediately, check error code first
      if (data.error?.code === "ok") {
        console.warn(
          "[TikTok Publish] Publish successful but no share_id returned immediately."
        );
        // Consider the publish successful even without immediate share_id
        return { share_id: `published-${publishId}` }; // Return a placeholder
      }
      throw new Error(
        "TikTok publish response missing share_id and no 'ok' error code."
      );
    }

    console.log("[TikTok Publish] Success. Share ID:", data.data.share_id);
    return {
      share_id: data.data.share_id,
    };
  } catch (error) {
    console.error("[TikTok Publish] Error:", error);
    throw new Error(
      `Failed to publish TikTok video: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
