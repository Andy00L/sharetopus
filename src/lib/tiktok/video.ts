// lib/tiktok/video.ts
import axios from "axios";
import FormData from "form-data";
import { TikTokApiClient } from "./client";

export type TikTokVideoInitResponse = {
  upload_url: string;
  video_id: string;
};

export type TikTokVideoPublishResponse = {
  share_id: string;
  video_id: string;
};

/**
 * Upload and publish a video to TikTok
 */
export async function uploadVideoToTikTok(
  client: TikTokApiClient,
  videoBuffer: Buffer,
  caption: string
): Promise<TikTokVideoPublishResponse> {
  try {
    // Step 1: Initiate the video upload
    const initResponse = await client.request<{
      data: TikTokVideoInitResponse;
    }>({
      method: "POST",
      url: "/share/video/upload/",
      data: {
        source_info: {
          source: "FILE_UPLOAD",
        },
      },
    });

    if (!initResponse.data || !initResponse.data.upload_url) {
      throw new Error("Failed to initiate TikTok video upload");
    }

    // Step 2: Upload the video file
    const formData = new FormData();
    formData.append("video", videoBuffer, {
      filename: "video.mp4",
      contentType: "video/mp4",
    });

    await axios.post(initResponse.data.upload_url, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    // Step 3: Publish the video
    const publishResponse = await client.request<{
      data: TikTokVideoPublishResponse;
    }>({
      method: "POST",
      url: "/share/video/publish/",
      data: {
        video_id: initResponse.data.video_id,
        title: caption,
      },
    });

    if (!publishResponse.data) {
      throw new Error("Failed to publish TikTok video");
    }

    return publishResponse.data;
  } catch (error) {
    console.error("Error uploading video to TikTok:", error);
    throw error;
  }
}
