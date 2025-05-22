// createPostForm/action/directPostForPinterestAccounts.ts
"use server";
import { storeContentHistory } from "@/actions/server/contentHistoryActions/storeContentHistory";
import { storeFailedPost } from "@/actions/server/contentHistoryActions/storeFailedPost";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { postToPinterest } from "@/lib/api/pinterest/post/postToPinterest";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { ScheduleResult } from "../Scheduled/scheduleForPinterestAccounts";

/**
 * Directly posts content to Pinterest accounts without scheduling
 * Converts the file to base64 and sends it to the Pinterest API
 */
export async function directPostForPinterestAccounts(config: {
  account: SocialAccount;
  mediaPath: string;
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
  thumbnailBuffer?: Buffer;
  buffer?: Buffer;
  isCronJob?: boolean;
}): Promise<ScheduleResult> {
  const {
    account,
    mediaPath,
    boards,
    accountContent,
    userId,
    batchId,
    buffer,
    mediaType,
    postType,
    fileName,
    isCronJob,
  } = config;

  if (!account) {
    console.error("[Pinterest Direct Post] Error fetching accounts:");

    return {
      success: false,
      count: 0,
      message: "Failed to fetch social accounts",
    };
  }

  let successCount = 0;

  try {
    console.log(
      "[Pinterest Direct Post] Starting to post directly to Pinterest"
    );

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

    if (!validToken) {
      console.error(
        `[Pinterest Direct Post] No valid access token for account ${account.id}`
      );
      return {
        success: false,
        count: 0,
        message: "Invalid or expired access token",
      };
    }

    try {
      console.log(
        `[Pinterest Direct Post] Posting to account: ${
          account.username ?? account.id
        }`
      );

      // Call our new postToPinterest function instead of the API endpoint
      const postResult = await postToPinterest({
        accessToken: validToken,
        boardId: boards.boardID,
        title: accountContent.title,
        description: accountContent.description,
        link: accountContent.link,
        mediaPath: mediaPath,
        mediaType: mediaType,
        fileName: fileName,
        userId: userId ?? "",
        buffer,
        thumbnailBuffer: config.thumbnailBuffer,
        supabaseBucket: "scheduled-videos",
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
        try {
          // Store content history (similar to Pinterest)
          await storeContentHistory(
            {
              platform: "pinterest",
              content_id: postResult.postId!,
              social_account_id: accountContent.accountId,
              title: accountContent.title ?? null,
              description: accountContent.description,
              media_url: postResult.postUrl!,
              batch_id: batchId,
              status: "posted",
              media_type: postType, // Use the same logic as in your extra.post_type
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

          successCount++;
          console.log(
            `[Pinterest Direct Post] Successfully posted to account and saved to history`
          );
        } catch (historyError) {
          console.error(
            `[Pinterest Direct Post] Error saving to content history:`,
            historyError
          );
          // Still increment success since the post succeeded
          successCount++;
        }
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
          try {
            await storeFailedPost({
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
              batch_id: batchId,
              extra_data: {
                message: postResult.message,
                error: postResult.error,
                timestamp: new Date().toISOString(),
                board_id: boards.boardID,
                board_name: boards.boardName,
              },
            });

            console.log(
              "[Pinterest Direct Post] Failed post stored in failed_posts table"
            );
          } catch (storeError) {
            console.error(
              "[Pinterest Direct Post] Error storing failed post:",
              storeError
            );
          }
        } else {
          console.log(
            "[Pinterest Direct Post] Skipping failed post storage (not a cron job)"
          );
        }
        return {
          success: false,
          count: 0,
          message: "Failed to post to Pinterest",
        };
      }
    } catch (postError) {
      console.error(
        `[Pinterest Direct Post] Error for account ${account.id}:`,
        postError
      );
    }

    return {
      success: successCount > 0,
      count: successCount,
      message: `Successfully posted to ${successCount} Pinterest account(s)`,
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
