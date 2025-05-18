// createPostForm/action/directPostForTikTokAccounts.ts
import { storeContentHistory } from "@/actions/server/contentHistoryActions/storeContentHistory";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { postToTikTok } from "@/lib/api/tiktok/post/postToTikTok";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import "server-only";

import { storeFailedPost } from "@/actions/server/contentHistoryActions/storeFailedPost";
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
  accountContent: {
    accountId: string;
    title?: string;
    description?: string;
    isCustomized: boolean;
  };
  userId: string | null;
  buffer?: Buffer;
  fileName: string;
  batchId: string;
  isCronJob?: boolean;
}): Promise<ScheduleResult> {
  const {
    account,
    mediaPath,
    mediaType,
    platformOptions,
    accountContent,
    userId,
    buffer,
    batchId,
    isCronJob,
  } = config;

  try {
    console.log("[TikTok Direct Post] Starting to post directly to TikTok");

    // Determine if we're posting image(s) or video
    const isImage = mediaType?.startsWith("image/");
    const isVideo = mediaType?.startsWith("video/");
    //Implementation temporaire
    if (isImage) {
      console.error("[TikTok Direct Post] We don't support image upload");
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

    if (!accountContent || accountContent.accountId !== account.id) {
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

    // Call our TikTok posting function
    const postResult = await postToTikTok({
      accessToken: validToken,
      title: accountContent.title ?? "",
      description: accountContent.description ?? "",
      tikTokOptions: platformOptions.tiktok,
      mediaPath: mediaPath,
      buffer,
      mediaType: mediaType ?? "",
      userId: userId ?? "",
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

    if (postResult.success) {
      try {
        // Store content history
        await storeContentHistory(
          {
            platform: "tiktok",
            content_id: postResult.postId || postResult.publishId || "",
            social_account_id: accountContent.accountId,
            title: accountContent.title || null,
            description: accountContent.description || null,
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
      if (isCronJob) {
        try {
          await storeFailedPost({
            user_id: userId,
            social_account_id: account.id,
            platform: "tiktok",
            post_title: accountContent.title || null,
            post_description: accountContent.description || null,
            post_options: platformOptions.tiktok,
            media_type: isVideo ? "video" : isImage ? "image" : "text",
            media_storage_path: mediaPath,
            batch_id: batchId,
            extra_data: {
              message: postResult.message,
              details: postResult.details,
              error: postResult.error,
              timestamp: new Date().toISOString(),
            },
          });

          console.log(
            "[TikTok Direct Post] Failed post stored in failed_posts table"
          );
        } catch (storeError) {
          console.error(
            "[TikTok Direct Post] Error storing failed post:",
            storeError
          );
        }
      } else {
        console.log(
          "[TikTok Direct Post] Skipping failed post storage (not a cron job)"
        );
      }
      return {
        success: false,
        count: 0,
        message: postResult.message || "Failed to post to TikTok",
      };
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

    return {
      success: false,
      count: 0,
      message: `Failed to post to TikTok`,
    };
  }
}
