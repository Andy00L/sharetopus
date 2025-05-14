// createPostForm/action/directPostForTikTokAccounts.ts
import { storeContentHistory } from "@/actions/server/contentHistoryActions/storeContentHistory";
import { deleteSupabaseFileAction } from "@/actions/server/data/deleteSupabaseFileAction";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { postToTikTok } from "@/lib/api/tiktok/post/postToTikTok";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import "server-only";

import { ScheduleResult } from "../Scheduled/scheduleForPinterestAccounts";

/**
 * Directly posts content to TikTok accounts without scheduling
 * Handles videos with FILE_UPLOAD and tries to use signed URLs for images
 */
export async function directPostForTikTokAccounts(config: {
  account: SocialAccount;
  mediaPath: string;
  mediaType: string;
  platformOptions: PlatformOptions;
  accountContent: Array<{
    accountId: string;
    title?: string;
    description?: string;
    isCustomized: boolean;
  }>;
  userId: string | null;
  buffer?: Buffer;
  cleanupFiles?: boolean;
  fileName: string;
  batchId: string;
}): Promise<ScheduleResult> {
  const {
    account,
    mediaPath,
    mediaType,
    platformOptions,
    accountContent,
    userId,
    buffer,
    cleanupFiles = true,
    batchId,
    fileName,
  } = config;
  if (!account) {
    console.error("[TikTok Direct Post] No account provided");

    // Cleanup code if no accounts found
    if (cleanupFiles && mediaPath) {
      await deleteSupabaseFileAction(userId, mediaPath, true);
    }

    return {
      success: false,
      count: 0,
      message: "No TikTok account provided",
    };
  }

  try {
    console.log("[TikTok Direct Post] Starting to post directly to TikTok");

    // Determine if we're posting image(s) or video
    const isImage = mediaType?.startsWith("image/");
    const isVideo = mediaType?.startsWith("video/");
    //Implementation temporaire
    if (isImage) {
      console.error("[TikTok Direct Post] We don't support image uploaf");
      return {
        success: false,
        count: 0,
        message: " We don't support image uploaf",
      };
    }
    if (!isVideo && !isImage) {
      console.error("[TikTok Direct Post] Unsupported media type:", mediaType);
      return {
        success: false,
        count: 0,
        message: "Unsupported media type. Must be image or video.",
      };
    }

    const content = accountContent[0];
    if (!content || content.accountId !== account.id) {
      console.error(
        `[TikTok Direct Post] No or mismatched content for account ${account.id}`
      );
      return {
        success: false,
        count: 0,
        message: "No content found for account",
      };
    }

    const validToken = await ensureValidToken(account);
    if (!validToken) {
      console.error(
        `[TikTok Direct Post] No valid access token for account ${account.id}`
      );
      return {
        success: false,
        count: 0,
        message: "Invalid or expired access token",
      };
    }

    console.log(
      `[TikTok Direct Post] Posting to account: ${
        account.username ?? account.id
      }`
    );
    console.log(`[TikTok Direct Post] Media path: ${mediaPath}`);
    console.log(`[TikTok Direct Post] Media type: ${mediaType}`);
    console.log(`[TikTok Direct Post] File name: ${fileName}`);
    // Call our TikTok posting function
    const postResult = await postToTikTok({
      accessToken: validToken,
      title: content.title || "",
      description: content.description || "",
      tikTokOptions: platformOptions.tiktok,
      mediaPath: mediaPath,
      buffer,
      mediaType: mediaType || "",
      userId: userId || "",
    });

    // Add detailed console logging
    console.log(
      `========== TIKTOK POST RESPONSE (${account.username}) ==========`
    );
    console.log("Success:", postResult.success);
    console.log("Publish ID:", postResult.publishId);
    console.log("Post ID:", postResult.postId);
    console.log("Post URL:", postResult.postUrl);
    console.log("Message:", postResult.message);
    console.log("Complete data structure:");
    console.log(JSON.stringify(postResult.data, null, 2));

    if (postResult.success) {
      try {
        // Store content history
        await storeContentHistory(
          {
            platform: "tiktok",
            content_id: postResult.postId || postResult.publishId || "",
            social_account_id: content.accountId,
            title: content.title || null,
            description: content.description || null,
            media_url: postResult.postUrl || null,
            batch_id: batchId,
            status: postResult.status,
            media_type: isImage ? "image" : "video",
            extra: {
              post_data: postResult.data,
              post_type: isImage ? "image" : "video",
              posted_at: new Date().toISOString(),
              privacy_level: platformOptions.tiktok,
            },
          },
          userId
        );

        console.log(
          `[TikTok Direct Post] Successfully posted to account and saved to history`
        );
      } catch (historyError) {
        console.error(
          `[TikTok Direct Post] Error saving to content history:`,
          historyError
        );
      }
    }
    // Add more detailed error logging
    if (!postResult.success) {
      console.error(
        "[TikTok Direct Post] Failed with error:",
        postResult.error
      );

      console.error("[TikTok Direct Post] Error details:", postResult.details);
      console.error("[TikTok Direct Post] Error message:", postResult.message);
    }

    // Clean up the media file if posting was successful
    if (cleanupFiles) {
      await deleteSupabaseFileAction(userId, mediaPath, true);
      console.log(
        "[TikTok Direct Post] Cleaned up temporary media file after successful posting"
      );
    }

    return {
      success: true,
      count: 1,
      message: `Successfully posted to TikTok account ${
        account.username || account.id
      }`,
    };
  } catch (error) {
    console.error("[TikTok Direct Post] Error:", error);

    // Clean up the media file in case of error
    if (cleanupFiles && mediaPath) {
      await deleteSupabaseFileAction(userId, mediaPath, true);
      console.log(
        "[TikTok Direct Post] Cleaned up temporary media file after error"
      );
    }

    return {
      success: false,
      count: 0,
      message: `Failed to post to TikTok`,
    };
  }
}
