// lib/api/tiktok/uploadTikTokVideoChunks.ts

/**
 * Uploads video data to TikTok's upload URL
 *
 * @param uploadUrl URL provided by TikTok for uploading the video
 * @param videoBuffer The video file data as a Buffer
 * @returns Success status
 */
export async function uploadTikTokVideoChunks(
  uploadUrl: string,
  videoBuffer: Buffer
): Promise<boolean> {
  try {
    console.log(`[TikTok] Uploading video (${videoBuffer.length} bytes)`);

    // Upload the video data to the provided URL
    // Note: For larger files, you might need to implement chunked uploading
    // based on TikTok's API documentation
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      body: videoBuffer,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[TikTok] Video upload failed:", errorText);
      throw new Error(`TikTok upload error: ${response.status} - ${errorText}`);
    }

    console.log("[TikTok] Video upload successful");
    return true;
  } catch (error) {
    console.error("[TikTok] Video upload exception:", error);
    throw error;
  }
}
