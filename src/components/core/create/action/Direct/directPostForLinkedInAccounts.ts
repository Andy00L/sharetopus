"use server";
// createPostForm/action/directPostForLinkedInAccounts.ts
import { storeContentHistory } from "@/actions/server/contentHistoryActions/storeContentHistory";
import { deleteSupabaseFileAction } from "@/actions/server/data/deleteSupabaseFileAction";
import { postToLinkedIn } from "@/lib/api/linkedin/post/postToLinkedIn";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { ScheduleResult } from "../Scheduled/scheduleForPinterestAccounts";
import { getMimeTypeFromFileName } from "./getMimeTypeFromFileName";

export async function directPostForLinkedInAccounts(config: {
  accounts: SocialAccount[]; // Changed from accounts to accountIds
  mediaPath: string;
  platformOptions: PlatformOptions;
  accountContent: Array<{
    accountId: string;
    title?: string;
    description: string;
    link: string;
    isCustomized: boolean;
  }>;
  userId: string | null;
  cleanupFiles?: boolean;
  fileName?: string;
}): Promise<ScheduleResult> {
  const {
    accounts,
    mediaPath,
    accountContent,
    userId,
    cleanupFiles = true,
    fileName,
  } = config;

  if (!accounts || accounts.length === 0) {
    console.error("[LinkedIn Direct Post] Error fetching accounts:");

    // New cleanup code
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
    console.log("[LinkedIn Direct Post] Starting to post directly to LinkedIn");

    // Convert the file to base64 (only if provided)
    let mediaType: string | undefined;

    if (mediaPath && mediaPath.trim() !== "") {
      try {
        console.log(fileName);
        mediaType = getMimeTypeFromFileName(fileName);
        console.log("[LinkedIn Direct Post] Detected MIME type:", mediaType); // Add this log

        console.log(
          "[LinkedIn Direct Post] Verified file exists, will stream for upload"
        );
      } catch (fileProcessingError) {
        console.error(
          "[LinkedIn Direct Post] Error processing file:",
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
    }

    // Loop through accounts (keeping similar structure to your original code)
    for (const account of accounts) {
      // Find content specific to this account
      const content = accountContent.find(
        (item) => item.accountId === account.id
      );

      // Skip if no content found for this account
      if (!content) {
        console.error(
          `[LinkedIn Direct Post] No content found for account ${account.id}`
        );
        continue;
      }

      // Verify access token is available
      if (!account.access_token) {
        console.error(
          `[LinkedIn Direct Post] No access token for account ${account.id}`
        );
        continue;
      }

      // Get member URN from the account identifier
      const memberUrn = account.account_identifier
        ? `urn:li:person:${account.account_identifier}`
        : null;

      if (!memberUrn) {
        console.error(
          `[LinkedIn Direct Post] No LinkedIn member URN found for account ${account.id}`
        );

        continue;
      }

      try {
        console.log(
          `[LinkedIn Direct Post] Posting to account: ${
            account.username ?? account.id
          }`
        );

        // Call our API endpoint to post to LinkedIn
        const postResult = await postToLinkedIn({
          accessToken: account.access_token,
          memberUrn: memberUrn,
          text: content.description,
          link: content.link,
          mediaPath: mediaPath,
          mediaType: mediaType,
          fileName: fileName,
          userId: userId ?? "",
        });

        // Add detailed console logging to examine the response structure
        console.log(
          `========== LINKEDIN POST RESPONSE (${account.username}) ==========`
        );
        console.log("Success:", postResult.success);
        console.log("Post ID:", postResult.postId);
        console.log("Message:", postResult.message);
        console.log("Complete data structure:");
        console.log(JSON.stringify(postResult.data, null, 2));

        // Determine post type for history
        let postType = "text";
        if (mediaPath) {
          postType = mediaType?.startsWith("image/") ? "image" : "video";
        }

        if (postResult.success) {
          try {
            // Store content history
            await storeContentHistory(
              {
                platform: "linkedin",
                contentId: postResult.postId,
                title: content.title ?? null,
                description: content.description,
                mediaUrl: `https://www.linkedin.com/feed/update/${postResult.postId}`,
                extra: {
                  post_data: postResult.data,
                  post_type: postType,
                  posted_at: new Date().toISOString(),
                },
              },
              userId
            );

            successCount++;
            console.log(
              `[LinkedIn Direct Post] Successfully posted to account and saved to history`
            );
          } catch (historyError) {
            console.error(
              `[LinkedIn Direct Post] Error saving to content history:`,
              historyError
            );
            // Still increment success since the post succeeded
            successCount++;
          }
        }
      } catch (postError) {
        console.error(
          `[LinkedIn Direct Post] Error for account ${account.id}:`,
          postError
        );
      }
    }

    if (cleanupFiles && mediaPath && successCount > 0) {
      await deleteSupabaseFileAction(userId, mediaPath, true);

      console.log(
        "[LinkedIn Direct Post] Cleaned up temporary media file after successful posting"
      );
    }

    return {
      success: true,
      count: successCount,
      message: `Successfully posted to ${successCount} LinkedIn account(s)`,
    };
  } catch (error) {
    console.error("[LinkedIn Direct Post] Error:", error);
    // New cleanup code
    if (cleanupFiles && mediaPath) {
      await deleteSupabaseFileAction(userId, mediaPath, true);

      console.log(
        "[LinkedIn Direct Post] Cleaned up temporary media file after error"
      );
    }
    return {
      success: false,
      count: 0,
      message: `Failed to post to LinkedIn: `,
    };
  }
}
