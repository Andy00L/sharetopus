// createPostForm/action/directPostForInstagramAccounts.ts
import { storeContentHistory } from "@/actions/server/contentHistoryActions/storeContentHistory";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { postToInstagram } from "@/lib/api/instagram/post/postToInstagram";
import { SocialAccount } from "@/lib/types/dbTypes";
import "server-only";

import { storeFailedPost } from "@/actions/server/contentHistoryActions/storeFailedPost";
import { ScheduleResult } from "../Scheduled/scheduleForPinterestAccounts";

/**
 * Directly posts content to Instagram accounts without scheduling
 * Handles images and videos (as Reels) with Instagram Graph API
 */
export async function directPostForInstagramAccounts(config: {
  account: SocialAccount;
  mediaPath: string;
  coverTimestamp: number;
  mediaType: string;
  accountContent: {
    accountId: string;
    title: string;
    description: string;
    isCustomized: boolean;
  };
  userId: string | null;
  mediaUrl: string;
  postType: "image" | "video";
  fileName: string;
  batchId: string;
  isCronJob?: boolean;
}): Promise<ScheduleResult> {
  const {
    account,
    mediaPath,
    postType,
    mediaType,
    accountContent,
    userId,
    mediaUrl,
    batchId,
    isCronJob,
  } = config;

  try {
    console.log(
      "[Instagram Direct Post] Starting to post directly to Instagram"
    );

    if (!accountContent || accountContent.accountId !== account.id) {
      console.error(
        `[Instagram Direct Post] No or mismatched content for account ${account.id}`
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
        `[Instagram Direct Post] No valid access token for account ${account.id}`
      );
      return {
        success: false,
        count: 0,
        message: validToken.error,
      };
    }

    // Validate Instagram Business/Creator account ID
    if (!account.account_identifier) {
      console.error(
        `[Instagram Direct Post] Missing Instagram Business/Creator account ID for account ${account.id}`
      );
      return {
        success: false,
        count: 0,
        message: "Missing Instagram Business/Creator account ID",
      };
    }

    console.log(
      `[Instagram Direct Post] Posting to account: ${
        account.username ?? account.id
      }`
    );

    // Map generic postType to Instagram-specific types
    let instagramPostType: "image" | "reel" | "carousel";

    if (postType === "video") {
      instagramPostType = "reel";
    } else {
      // "text" maps to "image" since Instagram doesn't support text-only posts
      instagramPostType = "image";
    }
    // Call our Instagram posting function
    const postResult = await postToInstagram({
      accessToken: validToken.token!,
      userId: account.account_identifier,
      caption: accountContent.description ?? "",
      mediaUrl: mediaUrl,
      mediaType: mediaType ?? "",
      fileName: config.fileName,
      postType: instagramPostType,
      coverTimestamp: config.coverTimestamp,
      altText: accountContent.description.substring(0, 1000) || "viral post",
      shareToFeed: true,
    });

    // Add detailed console logging
    console.log(
      `========== INSTAGRAM POST RESPONSE (${account.username}) ==========`
    );
    console.log("Success:", postResult.success);
    console.log("Post ID:", postResult.postId);
    console.log("Container ID:", postResult.containerId);
    console.log("Message:", postResult.message);

    if (postResult.success) {
      // Store content history
      const historyResult = await storeContentHistory(
        {
          platform: "instagram",
          content_id: postResult.postId ?? "",
          social_account_id: accountContent.accountId,
          title: accountContent.title || null,
          description: accountContent.description || null,
          media_url: postResult.publicUrl!,
          batch_id: batchId,
          status: "posted",
          media_type: postType,
          extra: {
            post_data: postResult,
            post_type: postType,
            posted_at: new Date().toISOString(),
          },
        },
        userId
      );

      if (!historyResult.success) {
        console.error(
          `[Instagram Direct Post] Error saving to content history:`,
          historyResult.message
        );
        return {
          success: false,
          count: 0,
          message: `Post succeeded but failed to save history: ${historyResult.message}`,
        };
      }

      console.log(
        `[Instagram Direct Post] Successfully posted to account and saved to history`
      );
    }

    // Add more detailed error logging
    if (!postResult.success) {
      console.error(
        "[Instagram Direct Post] Failed with error:",
        postResult.message
      );

      if (isCronJob) {
        const failedPostResult = await storeFailedPost({
          user_id: userId,
          social_account_id: account.id,
          platform: "instagram",
          post_title: accountContent.title || null,
          post_description: accountContent.description || null,
          media_type: postType,
          media_storage_path: mediaPath,
          coverTimestamp: config.coverTimestamp,
          batch_id: batchId,
          extra_data: {
            message: postResult.message,
            timestamp: new Date().toISOString(),
          },
        });

        if (!failedPostResult.success) {
          console.error(
            "[Instagram Direct Post] Error storing failed post:",
            failedPostResult.message
          );
          return {
            success: false,
            count: 0,
            message: `Post failed and couldn't save failure record: ${failedPostResult.message}`,
          };
        }

        console.log(
          "[Instagram Direct Post] Failed post stored in failed_posts table"
        );
      } else {
        console.log(
          "[Instagram Direct Post] Skipping failed post storage (not a cron job)"
        );
      }

      return {
        success: false,
        count: 0,
        message: postResult.message || "Failed to post to Instagram",
      };
    }

    return {
      success: true,
      count: 1,
      message: `Successfully posted to Instagram account ${
        account.username || account.id
      }`,
    };
  } catch (error) {
    console.error("[Instagram Direct Post] Error:", error);

    return {
      success: false,
      count: 0,
      message: `Failed to post to Instagram`,
    };
  }
}
