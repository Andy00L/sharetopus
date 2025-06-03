"use server";
// createPostForm/action/directPostForLinkedInAccounts.ts
import { storeContentHistory } from "@/actions/server/contentHistoryActions/storeContentHistory";
import { storeFailedPost } from "@/actions/server/contentHistoryActions/storeFailedPost";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { postToLinkedIn } from "@/lib/api/linkedin/post/postToLinkedIn";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { ScheduleResult } from "../Scheduled/scheduleForPinterestAccounts";
import { getSupabaseVideoFile } from "@/actions/server/data/getSupabaseVideoFile";

export async function directPostForLinkedInAccounts(config: {
  account: SocialAccount; // Changed from accounts to accountIds
  mediaPath: string;
  coverTimestamp?: number;

  mediaType?: string;
  platformOptions: PlatformOptions;
  accountContent: {
    accountId: string;
    title?: string;
    description: string;
    link: string;
    isCustomized: boolean;
  };
  userId: string | null;
  cleanupFiles?: boolean;
  fileName?: string;
  batchId: string;
  postType: "image" | "video" | "text";
  isCronJob?: boolean;
}): Promise<ScheduleResult> {
  const {
    account,
    mediaPath,
    mediaType,
    accountContent,
    userId,
    batchId,
    postType,
    fileName,
    isCronJob,
  } = config;

  if (!account) {
    console.error("[LinkedIn Direct Post] Error fetching accounts:");

    return {
      success: false,
      count: 0,
      message: "No LinkedIn account provided",
    };
  }

  if (!accountContent) {
    return {
      success: false,
      count: 0,
      message: "No content found for account",
    };
  }
  try {
    console.log("[LinkedIn Direct Post] Starting to post directly to LinkedIn");
    // Download the file for direct upload
    const buffer = await getSupabaseVideoFile(mediaPath, userId);
    if (!buffer.success) {
      return {
        success: false,
        count: 0,
        message: buffer.message,
      };
    }
    // Vérifier et rafraîchir le token si nécessaire
    const validToken = await ensureValidToken(account);

    if (!validToken.success) {
      console.error(
        `[Linkedin Direct Post] No valid access token for account ${account.id}`
      );
      return {
        success: false,
        count: 0,
        message: validToken.error,
      };
    }

    // Get member URN from the account identifier
    const memberUrn = account.account_identifier
      ? `urn:li:person:${account.account_identifier}`
      : null;

    if (!memberUrn) {
      console.error(
        `[LinkedIn Direct Post] No LinkedIn member URN found for account ${account.id}`
      );

      return {
        success: false,
        count: 0,
        message: "No LinkedIn identifier found for account",
      };
    }

    console.log(
      `[LinkedIn Direct Post] Posting to account: ${
        account.username ?? account.id
      }`
    );

    // Call our API endpoint to post to LinkedIn
    const postResult = await postToLinkedIn({
      accessToken: validToken.token!,
      memberUrn: memberUrn,
      text: accountContent.description,
      link: accountContent.link,
      mediaPath: mediaPath,
      mediaType: mediaType,
      fileName: fileName,
      userId: userId ?? "",
      postType,
      buffer: buffer.buffer,
      coverTimestamp: config.coverTimestamp,
    });

    // Add detailed console logging to examine the response structure
    console.log(
      `========== LINKEDIN POST RESPONSE (${account.username}) ==========`
    );
    console.log("Success:", postResult.success);
    console.log("Post ID:", postResult.postId);
    console.log("Message:", postResult.message);

    if (postResult.success) {
      // Store content history
      const historyResult = await storeContentHistory(
        {
          platform: "linkedin",
          content_id: postResult.postId,
          title: accountContent.title ?? null,
          description: accountContent.description,
          media_url: `https://www.linkedin.com/feed/update/${postResult.postId}`,
          batch_id: batchId,
          media_type: postType,
          status: "posted",
          social_account_id: accountContent.accountId,
          extra: {
            post_data: postResult.data,
            post_type: postType,
            posted_at: new Date().toISOString(),
          },
        },
        userId
      );

      if (!historyResult.success) {
        console.error(
          `[LinkedIn Direct Post] Error saving to content history:`,
          historyResult.message
        );
        return {
          success: false,
          count: 0,
          message: `Post succeeded but failed to save history: ${historyResult.message}`,
        };
      }

      console.log(
        `[LinkedIn Direct Post] Successfully posted to account and saved to history`
      );
    } else {
      console.error(
        "[LinkedIn Direct Post] Failed with error:",
        postResult.error
      );
      console.error(
        "[LinkedIn Direct Post] Error message:",
        postResult.message
      );
      if (isCronJob) {
        const failedPostResult = await storeFailedPost({
          user_id: userId,
          social_account_id: account.id,
          platform: "linkedin",
          post_title: accountContent.title || null,
          post_description: accountContent.description || null,
          coverTimestamp: config.coverTimestamp,

          post_options: {
            memberUrn: memberUrn,
            link: accountContent.link,
            visibility: config.platformOptions.linkedin?.visibility || "PUBLIC",
          },
          media_type: postType,
          media_storage_path: mediaPath || "",
          batch_id: batchId,
          extra_data: {
            message: postResult.message,
            error: postResult.error,
            timestamp: new Date().toISOString(),
          },
        });

        if (!failedPostResult.success) {
          console.error(
            "[LinkedIn Direct Post] Error storing failed post:",
            failedPostResult.message
          );
          return {
            success: false,
            count: 0,
            message: `Post failed and couldn't save failure record: ${failedPostResult.message}`,
          };
        }

        console.log(
          "[LinkedIn Direct Post] Failed post stored in failed_posts table"
        );
      } else {
        console.log(
          "[LinkedIn Direct Post] Skipping failed post storage (not a cron job)"
        );
      }
      return {
        success: false,
        count: 0,
        message: postResult.message || "Failed to post to LinkedIn",
      };
    }

    return {
      success: true,
      count: 1,
      message: `Successfully posted to ${account.display_name} LinkedIn account(s)`,
    };
  } catch (error) {
    console.error(
      "[LinkedIn Direct Post] Error for account ${account.id}:",
      error
    );

    return {
      success: false,
      count: 0,
      message: `Failed to post to LinkedIn: `,
    };
  }
}
