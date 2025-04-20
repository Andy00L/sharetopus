// lib/api/tiktok/initializeTikTokVideoUpload.ts

/**
 * Interface for TikTok video upload initialization response
 */
export interface TikTokVideoUploadInit {
  data: {
    upload_url: string;
    publish_id: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Initialize a video upload session with TikTok
 *
 * @param accessToken TikTok API access token
 * @param sourceInfo Information about the video being uploaded
 * @returns TikTok upload initialization response
 */
export async function initializeTikTokVideoUpload(
  accessToken: string,
  sourceInfo: {
    source_format: string; // e.g., "mp4"
    source_size: number; // file size in bytes
    source_duration: number; // duration in seconds
  }
): Promise<TikTokVideoUploadInit> {
  try {
    console.log("[TikTok] Initializing video upload session");

    // TikTok API endpoint for initializing video upload
    const url = "https://open.tiktokapis.com/v2/post/publish/video/init/";

    // Make the initialization request
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        post_info: {
          source_info: sourceInfo,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[TikTok] Video upload initialization failed:", errorText);
      throw new Error(`TikTok API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Check for errors in the response body
    if (data.error) {
      console.error("[TikTok] Video upload initialization error:", data.error);
      throw new Error(
        `TikTok API error: ${data.error.code} - ${data.error.message}`
      );
    }

    console.log("[TikTok] Video upload initialization successful:", data);

    return data;
  } catch (error) {
    console.error("[TikTok] Video upload initialization exception:", error);
    throw error;
  }
}
