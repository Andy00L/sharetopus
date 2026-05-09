// createPostForm/action/directPostForTikTokAccounts.ts
import { storeContentHistory } from "@/actions/server/contentHistoryActions/storeContentHistory";
import { insertPendingTikTokPull } from "@/actions/server/data/pendingTikTokPulls";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { postToTikTok } from "@/lib/api/tiktok/post/postToTikTok";
import { dispatchTikTokPublishPollEvent } from "@/inngest/functions/tikTokPublishStatusPollHelpers";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import "server-only";

import { ScheduleResult } from "../../pinterest/schedule/scheduleForPinterestAccounts";

/**
 * Directly posts content to TikTok accounts without scheduling
 * Handles videos with PULL_URL and tries to use signed URLs for images
 */
export async function directPostForTikTokAccounts(config: {
  account: SocialAccount;
  mediaPath: string;
  coverTimestamp: number;
  tiktokMediaUrl: string;
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
  scheduledPostId?: string;
}): Promise<ScheduleResult> {
  const {
    account,
    mediaPath,
    postType,
    mediaType,
    platformOptions,
    tiktokMediaUrl,
    accountContent,
    userId,
    batchId,
  } = config;

  try {
    console.log("[TikTok Direct Post] Starting to post directly to TikTok");

    if (!tiktokMediaUrl) {
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
      media_url: tiktokMediaUrl,
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
          scheduled_post_id: config.scheduledPostId ?? null,
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
          `[directPostForTikTokAccounts] Error saving to content history:`,
          historyResult.message
        );
        return {
          success: false,
          count: 0,
          message: `Post succeeded but failed to save history: ${historyResult.message}`,
        };
      }

      console.log(
        `[directPostForTikTokAccounts] Successfully posted to account and saved to history`
      );

      // Track this publish_id for race-safe cleanup gate and silent
      // failure correction. Best effort: log but do not fail the post.
      if (postResult.publishId) {
        const pendingInsert = await insertPendingTikTokPull({
          publish_id: postResult.publishId,
          principal_id: userId,
          social_account_id: accountContent.accountId,
          scheduled_post_id: config.scheduledPostId ?? null,
          content_history_id: historyResult.recordId ?? null,
          media_storage_path: mediaPath,
        });

        if (!pendingInsert.success) {
          console.error(
            "[directPostForTikTokAccounts] Failed to insert pending pull:",
            pendingInsert.message
          );
        } else {
          const dispatchResult = await dispatchTikTokPublishPollEvent({
            publish_id: postResult.publishId,
            content_history_id: historyResult.recordId ?? null,
            social_account_id: accountContent.accountId,
          });
          if (!dispatchResult.success) {
            console.error(
              "[directPostForTikTokAccounts] Failed to dispatch poll event:",
              dispatchResult.message
            );
          }
        }
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
