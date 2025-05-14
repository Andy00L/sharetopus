// createPostForm/action/directPostForPinterestAccounts.ts
"use server";
import { storeContentHistory } from "@/actions/server/contentHistoryActions/storeContentHistory";
import { deleteSupabaseFileAction } from "@/actions/server/data/deleteSupabaseFileAction";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { postToPinterest } from "@/lib/api/pinterest/post/postToPinterest";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { ScheduleResult } from "../Scheduled/scheduleForPinterestAccounts";

/**
 * Directly posts content to Pinterest accounts without scheduling
 * Converts the file to base64 and sends it to the Pinterest API
 */
export async function directPostForPinterestAccounts(config: {
  accounts: SocialAccount[];
  mediaPath: string;
  boards: Array<{
    boardID: string;
    boardName: string;
    accountId: string;
    isSelected: boolean;
  }>;
  platformOptions: PlatformOptions;
  accountContent: Array<{
    accountId: string;
    title: string;
    description: string;
    link: string;
    isCustomized: boolean;
  }>;
  userId: string | null;
  cleanupFiles?: boolean;
  fileName: string;
  batchId: string;
  mediaType: string;
  buffer?: Buffer;
}): Promise<ScheduleResult> {
  const {
    accounts,
    mediaPath,
    boards,
    accountContent,
    userId,
    cleanupFiles = true,
    batchId,
    buffer,
    mediaType,
    fileName,
  } = config;

  if (!accounts || accounts.length === 0) {
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

    for (const account of accounts) {
      // Find content specific to this account
      const content = accountContent.find(
        (item) => item.accountId === account.id
      );

      // Skip if no content found for this account
      if (!content) {
        console.error(
          `[Pinterest Direct Post] No content found for account ${account.id}`
        );
        continue;
      }

      // Vérifier et rafraîchir le token si nécessaire
      const validToken = await ensureValidToken(account);

      if (!validToken) {
        console.error(
          `[TikTok Direct Post] No valid access token for account ${account.id}`
        );
        continue;
      }
      // Get the selected board for this account
      const selectedBoard = boards.find(
        (board) => board.isSelected && board.accountId === account.id
      );

      if (!selectedBoard) {
        console.error(
          `[Pinterest Direct Post] No board selected for account ${account.id}`
        );
        continue;
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
          boardId: selectedBoard.boardID,
          title: content.title,
          description: content.description,
          link: content.link,
          mediaPath: mediaPath,
          mediaType: mediaType,
          fileName: fileName,
          userId: userId ?? "",
          buffer,
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
        console.log("Complete data structure:");
        console.log(JSON.stringify(postResult.data, null, 2));

        if (postResult.success) {
          try {
            // Store content history (similar to Pinterest)
            await storeContentHistory(
              {
                platform: "pinterest",
                content_id: postResult.postId!,
                social_account_id: content.accountId,
                title: content.title ?? null,
                description: content.description,
                media_url: postResult.postUrl!,
                batch_id: batchId,
                status: "posted",
                media_type: mediaType?.startsWith("image/") ? "image" : "video", // Use the same logic as in your extra.post_type
                extra: {
                  post_data: postResult.data,
                  post_type: mediaType?.startsWith("image/")
                    ? "image"
                    : "video",
                  posted_at: new Date().toISOString(),
                  board_id: selectedBoard.boardID,
                  board_name: selectedBoard.boardName,
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
        }
      } catch (postError) {
        console.error(
          `[Pinterest Direct Post] Error for account ${account.id}:`,
          postError
        );
      }
    }

    // Clean up the media file if posting was successful
    if (cleanupFiles) {
      await deleteSupabaseFileAction(userId, mediaPath, true);

      console.log(
        "[Pinterest Direct Post] Cleaned up temporary media file after successful posting"
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
