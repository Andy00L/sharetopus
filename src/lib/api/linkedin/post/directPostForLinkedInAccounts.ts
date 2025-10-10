"use server";
// createPostForm/action/directPostForLinkedInAccounts.ts
import { authCheck } from "@/actions/server/authCheck";
import { storeContentHistory } from "@/actions/server/contentHistoryActions/storeContentHistory";
import { storeFailedPost } from "@/actions/server/contentHistoryActions/storeFailedPost";
import { getSupabaseVideoFile } from "@/actions/server/data/getSupabaseVideoFile";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { postToLinkedIn } from "@/lib/api/linkedin/post/postToLinkedIn";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { ScheduleResult } from "../../pinterest/schedule/scheduleForPinterestAccounts";

interface AccountContent {
  accountId: string;
  title?: string;
  description: string;
  link: string;
  isCustomized: boolean;
}

interface DirectPostConfig {
  account: SocialAccount;
  mediaPath: string;
  coverTimestamp?: number;
  mediaType?: string;
  platformOptions: PlatformOptions;
  accountContent: AccountContent;
  userId: string | null;
  cleanupFiles?: boolean;
  fileName?: string;
  batchId: string;
  postType: "image" | "video" | "text";
  isCronJob?: boolean;
  cronSecret?: string;
}

/**
 * Posts content directly to a LinkedIn account
 *
 * This function:
 * 1. Validates authentication (unless cron job)
 * 2. Applies rate limiting (unless cron job)
 * 3. Downloads media files if needed
 * 4. Ensures valid LinkedIn access token
 * 5. Posts to LinkedIn
 * 6. Stores content history on success
 * 7. Stores failed post record on failure (cron jobs only)
 *
 * @param config - Configuration object containing account, content, and media details
 * @returns Result indicating success/failure with count and message
 */
export async function directPostForLinkedInAccounts(
  config: DirectPostConfig
): Promise<ScheduleResult> {
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
  try {
    if (!account) {
      console.error("[LinkedIn Direct Post] No account provided");

      return {
        success: false,
        count: 0,
        message: "No LinkedIn account provided",
      };
    }

    if (!accountContent) {
      console.error("[LinkedIn Direct Post] No account content provided");
      return {
        success: false,
        count: 0,
        message: "No content found for account",
      };
    }

    // Verify authentication (skip for cron jobs with valid secret)
    if (!isCronJob) {
      const authResult = await authCheck(userId);
      if (!authResult) {
        console.error(`[LinkedIn Direct Post] Auth failed for user: ${userId}`);
        return {
          success: false,
          count: 0,
          message: "Authentication validation failed. Please sign in again.",
        };
      }

      // Check rate limits (only for user-initiated posts, not cron)
      const rateCheck = await checkRateLimit(
        "directPostLinkedIn",
        userId,
        25, // 10 posts
        60 // per minute
      );

      if (!rateCheck.success) {
        console.warn(
          `[LinkedIn Direct Post] Rate limit exceeded for user: ${userId}`
        );
        return {
          success: false,
          count: 0,
          message: "Too many posts. Please try again later.",
        };
      }
    }

    let buffer;

    if (mediaPath) {
      buffer = await getSupabaseVideoFile(mediaPath, userId);

      if (!buffer.success) {
        console.error(
          `[LinkedIn Direct Post] Failed to fetch media:`,
          buffer.message
        );
        return {
          success: false,
          count: 0,
          message: buffer.message,
        };
      }
    }

    // Vérifier et rafraîchir le token si nécessaire
    const validToken = await ensureValidToken(account);

    if (!validToken.success) {
      console.error(
        `[LinkedIn Direct Post] Invalid token for account ${account.id}`
      );

      return {
        success: false,
        count: 0,
        message: validToken.error || "Failed to validate access token",
      };
    }

    // Get member URN from the account identifier
    const memberUrn = account.account_identifier
      ? `urn:li:person:${account.account_identifier}`
      : null;

    if (!memberUrn) {
      console.error(
        `[LinkedIn Direct Post] No member URN for account ${account.id}`
      );

      return {
        success: false,
        count: 0,
        message: "No LinkedIn identifier found for account",
      };
    }

    // Post to LinkedIn
    const postResult = await postToLinkedIn({
      accessToken: validToken.token!,
      memberUrn: memberUrn,
      text: accountContent.description,
      link: accountContent.link,
      mediaPath,
      mediaType,
      fileName: fileName,
      userId: userId ?? "",
      postType,
      buffer: buffer?.buffer,
      coverTimestamp: config.coverTimestamp,
    });

    console.log(
      `[LinkedIn Direct Post] Result for ${account.username}: ${
        postResult.success ? "SUCCESS" : "FAILED"
      }`
    );

    if (postResult.postId) {
      console.log(`[LinkedIn Direct Post] Post ID: ${postResult.postId}`);
    }

    // Handle successful post
    if (postResult.success) {
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
          `[LinkedIn Direct Post] Failed to save history:`,
          historyResult.message
        );
        return {
          success: false,
          count: 0,
          message: `Post succeeded but failed to save history: ${historyResult.message}`,
        };
      }

      return {
        success: true,
        count: 1,
        message: `Successfully posted to ${account.display_name}`,
      };
    }

    // Handle failed post
    console.error(
      `[LinkedIn Direct Post] Post failed:`,
      postResult.message,
      postResult.error
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
  } catch (error) {
    console.error(
      `[LinkedIn Direct Post] Unexpected error for account ${account.id}:`,
      error instanceof Error ? error.message : error
    );

    return {
      success: false,
      count: 0,
      message:
        error instanceof Error
          ? `Failed to post to LinkedIn: ${error.message}`
          : "Failed to post to LinkedIn",
    };
  }
}
