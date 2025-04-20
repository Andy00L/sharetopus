// lib/api/tiktok/finalizeTikTokVideoUpload.ts

/**
 * Interface for TikTok video upload completion response
 */
export interface TikTokVideoUploadComplete {
  data: {
    publish_id: string;
    video_id: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Finalize a video upload with TikTok
 *
 * @param accessToken TikTok API access token
 * @param publishId The publish_id from the initialization response
 * @returns TikTok upload completion response
 */
export async function finalizeTikTokVideoUpload(
  accessToken: string,
  publishId: string
): Promise<TikTokVideoUploadComplete> {
  try {
    console.log(
      `[TikTok] Finalizing video upload for publish_id: ${publishId}`
    );

    // TikTok API endpoint for finalizing video upload
    const url = "https://open.tiktokapis.com/v2/post/publish/video/complete/";

    // Make the finalization request
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        publish_id: publishId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[TikTok] Video upload finalization failed:", errorText);
      throw new Error(`TikTok API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Check for errors in the response body
    if (data.error) {
      console.error("[TikTok] Video upload finalization error:", data.error);
      throw new Error(
        `TikTok API error: ${data.error.code} - ${data.error.message}`
      );
    }

    console.log("[TikTok] Video upload finalization successful:", data);

    return data;
  } catch (error) {
    console.error("[TikTok] Video upload finalization exception:", error);
    throw error;
  }
}
