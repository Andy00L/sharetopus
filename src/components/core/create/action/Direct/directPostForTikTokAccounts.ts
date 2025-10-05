// createPostForm/action/directPostForTikTokAccounts.ts
import { storeContentHistory } from "@/actions/server/contentHistoryActions/storeContentHistory";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { postToTikTok } from "@/lib/api/tiktok/post/postToTikTok";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import "server-only";

import { createSecureMediaUrl } from "@/actions/client/mediaURL";
import { storeFailedPost } from "@/actions/server/contentHistoryActions/storeFailedPost";
import { ScheduleResult } from "../Scheduled/scheduleForPinterestAccounts";

/**
 * Directly posts content to TikTok accounts without scheduling
 * Handles videos with PULL_URL and tries to use signed URLs for images
 */
export async function directPostForTikTokAccounts(config: {
  account: SocialAccount;
  mediaPath: string;
  coverTimestamp: number;

  mediaType: string;
  platformOptions: PlatformOptions;
  accountContent: {
    accountId: string;
    title: string;
    description: string;
    isCustomized: boolean;
  };
  userId: string;
  postType: "image" | "video" | "text";

  fileName: string;
  batchId: string;
  isCronJob?: boolean;
}): Promise<ScheduleResult> {
  const {
    account,
    mediaPath,
    postType,
    mediaType,
    platformOptions,
    accountContent,
    userId,
    batchId,
    isCronJob,
  } = config;

  try {
    console.log("[TikTok Direct Post] Starting to post directly to TikTok");
    // Create secure URL for video
    const media_url = createSecureMediaUrl(mediaPath, userId);

    if (!media_url) {
      return {
        success: false,
        count: 0,
        message: "Content file could not be retrieve.",
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

    // Vérifier et rafraîchir le token si nécessaire
    const validToken = await ensureValidToken(account);

    if (!validToken.success) {
      console.error(
        `[TikTok Direct Post] No valid access token for account ${account.id}`
      );
      return {
        success: false,
        count: 0,
        message: validToken.error,
      };
    }

    console.log(
      `[TikTok Direct Post] Posting to account: ${
        account.username ?? account.id
      }`
    );

    // Call our TikTok posting function
    const postResult = await postToTikTok({
      accessToken: validToken.token!,
      title: accountContent.title ?? "",
      description: accountContent.description ?? "",
      tikTokOptions: platformOptions.tiktok,
      mediaType: mediaType ?? "",
      media_url: media_url,
      coverTimestamp: config.coverTimestamp,
      postType: postType,
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
      // Store content history
      const historyResult = await storeContentHistory(
        {
          platform: "tiktok",
          content_id: postResult.postId || postResult.publishId || "",
          social_account_id: accountContent.accountId,
          title: accountContent.title || null,
          description: accountContent.description || null,
          media_url: postResult.postUrl || null,
          batch_id: batchId,
          status: postResult.status,
          media_type: postType,
          extra: {
            post_data: postResult.data,
            post_type: postType,
            posted_at: new Date().toISOString(),
            privacy_level: platformOptions.tiktok,
          },
        },
        userId
      );

      if (!historyResult.success) {
        console.error(
          `[TikTok Direct Post] Error saving to content history:`,
          historyResult.message
        );
        return {
          success: false,
          count: 0,
          message: `Post succeeded but failed to save history: ${historyResult.message}`,
        };
      }

      console.log(
        `[TikTok Direct Post] Successfully posted to account and saved to history`
      );
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
        const failedPostResult = await storeFailedPost({
          user_id: userId,
          social_account_id: account.id,
          platform: "tiktok",
          post_title: accountContent.title || null,
          post_description: accountContent.description || null,
          post_options: platformOptions.tiktok,
          media_type: postType,
          media_storage_path: mediaPath,
          coverTimestamp: config.coverTimestamp,
          batch_id: batchId,
          extra_data: {
            message: postResult.message,
            details: postResult.details,
            error: postResult.error,
            timestamp: new Date().toISOString(),
          },
        });

        if (!failedPostResult.success) {
          console.error(
            "[TikTok Direct Post] Error storing failed post:",
            failedPostResult.message
          );
          return {
            success: false,
            count: 0,
            message: `Post failed and couldn't save failure record: ${failedPostResult.message}`,
          };
        }

        console.log(
          "[TikTok Direct Post] Failed post stored in failed_posts table"
        );
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
