// actions/tiktok/postContent.ts
"use server";

import fs from "fs/promises";
import path from "path";
import os from "os";

import { TikTokApiClient } from "@/lib/tiktok/client";
import { uploadVideoToTikTok } from "@/lib/tiktok/video";
import { PostStatus } from "@/actions/types/PostStatus ";
import { Provider } from "@/actions/types/provider";
import { auth } from "@clerk/nextjs/server";
import { createSocialPost } from "../server/supabase/createSocialPost";
import { getSocialAccount } from "../server/supabase/getSocialAccount";
import { markPostAsFailed } from "../server/supabase/markPostAsFailed";
import { markPostAsPublished } from "../server/supabase/markPostAsPublished";

/**
 * Post a video to TikTok
 */
export async function postVideoToTikTok(
  formData: FormData
): Promise<{ success: boolean; postId?: string; error?: string }> {
  try {
    const { userId } = await auth();
    if (!userId) {
      throw new Error("User not authenticated");
    }

    // Get form data
    const caption = formData.get("caption") as string;
    const videoFile = formData.get("video") as File;

    if (!videoFile || !caption) {
      throw new Error("Missing required fields: video and caption");
    }

    // Get user's TikTok account
    const tiktokAccount = await getSocialAccount(userId, "tiktok");
    if (!tiktokAccount || !tiktokAccount.enabled) {
      throw new Error("TikTok account not connected or disabled");
    }

    // Create a temporary file
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tiktok-"));
    const tempFilePath = path.join(tempDir, videoFile.name);

    // Write the file buffer to temp file
    const arrayBuffer = await videoFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.writeFile(tempFilePath, buffer);

    // Create a draft post in the database
    const post = await createSocialPost(userId, {
      provider: "tiktok" as Provider,
      caption,
      status: "draft" as PostStatus,
      media_url: tempFilePath,
    });

    if (!post) {
      throw new Error("Failed to create post record");
    }

    try {
      // Create TikTok API client
      const client = new TikTokApiClient(userId, tiktokAccount);

      // Upload and publish the video
      const result = await uploadVideoToTikTok(client, buffer, caption);

      // Update the post record as published
      await markPostAsPublished(post.id, result.video_id);

      // Clean up temp file
      await fs.rm(tempFilePath, { force: true });
      await fs.rmdir(tempDir, { recursive: true });

      return {
        success: true,
        postId: post.id,
      };
    } catch (uploadError) {
      // Mark post as failed
      await markPostAsFailed(
        post.id,
        uploadError instanceof Error
          ? uploadError.message
          : "Unknown upload error"
      );

      // Clean up temp file
      await fs.rm(tempFilePath, { force: true }).catch(console.error);
      await fs.rmdir(tempDir, { recursive: true }).catch(console.error);

      throw uploadError;
    }
  } catch (error) {
    console.error("Error posting to TikTok:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
