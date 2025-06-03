// createPostForm/action/directPostForPinterestAccounts.ts
import { storeContentHistory } from "@/actions/server/contentHistoryActions/storeContentHistory";
import { storeFailedPost } from "@/actions/server/contentHistoryActions/storeFailedPost";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { postToPinterest } from "@/lib/api/pinterest/post/postToPinterest";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import "server-only";
import { ScheduleResult } from "../Scheduled/scheduleForPinterestAccounts";
import { getSupabaseVideoFile } from "@/actions/server/data/getSupabaseVideoFile";

/**
 * Directly posts content to Pinterest accounts without scheduling
 * Converts the file to base64 and sends it to the Pinterest API
 */
export async function directPostForPinterestAccounts(config: {
  account: SocialAccount;
  mediaPath: string;
  coverTimestamp: number;

  boards: {
    boardID: string;
    boardName: string;
    accountId: string;
    isSelected: boolean;
  };
  platformOptions: PlatformOptions;
  accountContent: {
    accountId: string;
    title: string;
    description: string;
    link: string;
    isCustomized: boolean;
  };
  userId: string | null;
  fileName: string;
  batchId: string;
  mediaType: string;
  postType: "image" | "video" | "text";
  isCronJob?: boolean;
}): Promise<ScheduleResult> {
  const {
    account,
    mediaPath,
    boards,
    accountContent,
    userId,
    batchId,
    mediaType,
    postType,
    fileName,
    isCronJob,
  } = config;

  try {
    console.log(
      "[Pinterest Direct Post] Starting to post directly to Pinterest"
    );

     // Download the file for direct upload
     const buffer = await getSupabaseVideoFile(mediaPath, userId);
     if (!buffer.success) {
       return {
         success: false,
         count: 0,
         message: buffer.message,
       };
     }
    // Skip if no content found for this account
    if (!accountContent) {
      console.error(
        `[Pinterest Direct Post] No content found for account ${account.id}`
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
        `[Pinterest Direct Post] No valid access token for account ${account.id}`
      );
      return {
        success: false,
        count: 0,
        message: validToken.error,
      };
    }

    console.log(
      `[Pinterest Direct Post] Posting to account: ${
        account.username ?? account.id
      }`
    );

    // Call our new postToPinterest function instead of the API endpoint
    const postResult = await postToPinterest({
      accessToken: validToken.token!,
      boardId: boards.boardID,
      title: accountContent.title,
      description: accountContent.description,
      link: accountContent.link,
      mediaPath: mediaPath,
      mediaType: mediaType,
      fileName: fileName,
      userId: userId ?? "",
      buffer:buffer.buffer,
      coverTimestamp: config.coverTimestamp,
      postType: postType,
    });
    // Add detailed console logging
    console.log(
      `========== PINTEREST POST RESPONSE (${account.username}) ==========`
    );
    console.log("Success:", postResult.success);
    console.log("Post ID:", postResult.postId);
    console.log("Post URL:", postResult.postUrl);
    console.log("Message:", postResult.message);

    if (postResult.success) {
      // Store content history
      const historyResult = await storeContentHistory(
        {
          platform: "pinterest",
          content_id: postResult.postId!,
          social_account_id: accountContent.accountId,
          title: accountContent.title ?? null,
          description: accountContent.description,
          media_url: postResult.postUrl!,
          batch_id: batchId,
          status: "posted",
          media_type: postType,
          extra: {
            post_data: postResult.data,
            post_type: postType,
            posted_at: new Date().toISOString(),
            board_id: boards.boardID,
            board_name: boards.boardName,
          },
        },
        userId
      );

      if (!historyResult.success) {
        console.error(
          `[Pinterest Direct Post] Error saving to content history:`,
          historyResult.message
        );
        return {
          success: false,
          count: 0,
          message: `Post succeeded but failed to save history: ${historyResult.message}`,
        };
      }

      console.log(
        `[Pinterest Direct Post] Successfully posted to account and saved to history`
      );
    } else {
      console.error(
        "[Pinterest Direct Post] Failed with error:",
        postResult.error
      );
      console.error(
        "[Pinterest Direct Post] Error message:",
        postResult.message
      );

      if (isCronJob) {
        const failedPostResult = await storeFailedPost({
          user_id: userId,
          social_account_id: account.id,
          platform: "pinterest",
          post_title: accountContent.title || null,
          post_description: accountContent.description || null,
          post_options: {
            boardId: boards.boardID,
            boardName: boards.boardName,
            link: accountContent.link,
            ...config.platformOptions.pinterest,
          },
          media_type: postType,
          media_storage_path: mediaPath,
          coverTimestamp: config.coverTimestamp,

          batch_id: batchId,
          extra_data: {
            message: postResult.message,
            error: postResult.error,
            timestamp: new Date().toISOString(),
            board_id: boards.boardID,
            board_name: boards.boardName,
          },
        });

        if (!failedPostResult.success) {
          console.error(
            "[Pinterest Direct Post] Error storing failed post:",
            failedPostResult.message
          );
          return {
            success: false,
            count: 0,
            message: `Post failed and couldn't save failure record: ${failedPostResult.message}`,
          };
        }

        console.log(
          "[Pinterest Direct Post] Failed post stored in failed_posts table"
        );
      }

      return {
        success: false,
        count: 0,
        message: "Failed to post to Pinterest",
      };
    }

    return {
      success: true,
      count: 1,
      message: `Successfully posted to ${account.display_name} Pinterest account(s)`,
    };
  } catch (error) {
    console.error("[Pinterest Direct Post] Error:", error);

    return {
      success: false,
      count: 0,
      message: `Failed to post to Pinterest`,
    };
  }
}
