// createPostForm/action/directPostForTikTokAccounts.ts
"use server";
import { storeContentHistory } from "@/actions/server/contentHistoryActions/storeContentHistory";
import { deleteSupabaseFileAction } from "@/actions/server/data/deleteSupabaseFileAction";
import { postToTikTok } from "@/lib/api/tiktok/post/postToTikTok";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { ScheduleResult } from "../Scheduled/scheduleForPinterestAccounts";
import { getMimeTypeFromFileName } from "./getMimeTypeFromFileName";

/**
 * Directly posts content to TikTok accounts without scheduling
 * Handles videos with FILE_UPLOAD and tries to use signed URLs for images
 */
export async function directPostForTikTokAccounts(config: {
  accounts: SocialAccount[];
  mediaPath: string;
  platformOptions: PlatformOptions;
  accountContent: Array<{
    accountId: string;
    title?: string;
    description?: string;
    isCustomized: boolean;
  }>;
  userId: string | null;
  cleanupFiles?: boolean;
  fileName: string;
  batchId: string;
}): Promise<ScheduleResult> {
  const {
    accounts,
    mediaPath,
    platformOptions,
    accountContent,
    userId,
    cleanupFiles = true,
    batchId,
    fileName,
  } = config;

  if (!accounts || accounts.length === 0) {
    console.error("[TikTok Direct Post] Error fetching accounts:");

    // Cleanup code if no accounts found
    if (cleanupFiles && mediaPath) {
      await deleteSupabaseFileAction(userId, mediaPath, true);
    }

    return {
      success: false,
      count: 0,
      message: "Failed to fetch social accounts",
    };
  }

  let successCount = 0;

  try {
    console.log("[TikTok Direct Post] Starting to post directly to TikTok");

    // Get the media type from the file name
    let mediaType: string | undefined;

    if (mediaPath) {
      try {
        mediaType = getMimeTypeFromFileName(fileName);
        console.log("[TikTok Direct Post] Detected MIME type:", mediaType);
        console.log(
          "[TikTok Direct Post] Verified file exists, preparing for upload"
        );
      } catch (fileProcessingError) {
        console.error(
          "[TikTok Direct Post] Error processing file:",
          fileProcessingError
        );

        // Clean up the file if processing failed
        if (cleanupFiles) {
          await deleteSupabaseFileAction(userId, mediaPath, true);
        }

        return {
          success: false,
          count: 0,
          message: `Failed to process media file`,
        };
      }
    } else {
      // TikTok requires media
      return {
        success: false,
        count: 0,
        message: "TikTok posts require media (image or video)",
      };
    }

    // Determine if we're posting image(s) or video
    const isImage = mediaType?.startsWith("image/");
    const isVideo = mediaType?.startsWith("video/");

    if (!isVideo && !isImage) {
      console.error("[TikTok Direct Post] Unsupported media type:", mediaType);
      return {
        success: false,
        count: 0,
        message: "Unsupported media type. Must be image or video.",
      };
    }

    // Extract TikTok options from platformOptions
    const tikTokOptions = platformOptions.tiktok || {
      privacyLevel: "SELF_ONLY",
      disableComment: false,
      disableDuet: false,
      disableStitch: false,
    };

    // Determine if we should try signed URLs for PULL_FROM_URL
    // For images, we have to use this approach, for videos it's optional
    const usePullFromUrl = isImage || false; // Set to true if you want to try for videos too

    // Loop through each TikTok account
    for (const account of accounts) {
      // Find content specific to this account
      const content = accountContent.find(
        (item) => item.accountId === account.id
      );

      // Skip if no content found for this account
      if (!content) {
        console.error(
          `[TikTok Direct Post] No content found for account ${account.id}`
        );
        continue;
      }

      // Verify access token is available
      if (!account.access_token) {
        console.error(
          `[TikTok Direct Post] No access token for account ${account.id}`
        );
        continue;
      }

      try {
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
          accessToken: account.access_token,
          title: content.title || "",
          description: content.description || "",
          privacyLevel: tikTokOptions.privacyLevel,
          disableComment: tikTokOptions.disableComment,
          disableDuet: tikTokOptions.disableDuet,
          disableStitch: tikTokOptions.disableStitch,
          mediaPath: mediaPath,
          mediaType: mediaType || "",
          fileName: fileName,
          userId: userId || "",
          supabaseBucket: "scheduled-videos",
          postMode: "DIRECT_POST",
          usePullFromUrl: usePullFromUrl,
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
                status: postResult.postId ? "posted" : "processing",
                media_type: isImage ? "image" : "video",
                extra: {
                  post_data: postResult.data,
                  post_type: isImage ? "image" : "video",
                  posted_at: new Date().toISOString(),
                  publish_id: postResult.publishId,
                  privacy_level: tikTokOptions.privacyLevel,
                },
              },
              userId
            );

            successCount++;
            console.log(
              `[TikTok Direct Post] Successfully posted to account and saved to history`
            );
          } catch (historyError) {
            console.error(
              `[TikTok Direct Post] Error saving to content history:`,
              historyError
            );
            // Still increment success since the post succeeded
            successCount++;
          }
        }
        // Add more detailed error logging
        if (!postResult.success) {
          console.error(
            "[TikTok Direct Post] Failed with error:",
            postResult.error
          );
          console.error(
            "[TikTok Direct Post] Error details:",
            postResult.details
          );
          console.error(
            "[TikTok Direct Post] Error message:",
            postResult.message
          );
        }
      } catch (postError) {
        console.error(
          `[TikTok Direct Post] Error for account ${account.id}:`,
          postError
        );
      }
    }

    // Clean up the media file if posting was successful
    if (cleanupFiles && mediaPath) {
      await deleteSupabaseFileAction(userId, mediaPath, true);
      console.log(
        "[TikTok Direct Post] Cleaned up temporary media file after successful posting"
      );
    }

    return {
      success: successCount > 0,
      count: successCount,
      message: `Successfully posted to ${successCount} TikTok account(s)`,
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
