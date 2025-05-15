"use server";
// createPostForm/action/directPostForLinkedInAccounts.ts
import { storeContentHistory } from "@/actions/server/contentHistoryActions/storeContentHistory";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { postToLinkedIn } from "@/lib/api/linkedin/post/postToLinkedIn";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { ScheduleResult } from "../Scheduled/scheduleForPinterestAccounts";

export async function directPostForLinkedInAccounts(config: {
  account: SocialAccount; // Changed from accounts to accountIds
  mediaPath: string;
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

  buffer?: Buffer;
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
  } = config;

  if (!account) {
    console.error("[LinkedIn Direct Post] Error fetching accounts:");

    return {
      success: false,
      count: 0,
      message: "No LinkedIn account provided",
    };
  }

  let successCount = 0;

  try {
    console.log("[LinkedIn Direct Post] Starting to post directly to LinkedIn");

    // Skip if no content found for this account
    if (!accountContent) {
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
        `[Linkedin Direct Post] No valid access token for account ${account.id}`
      );
      return {
        success: false,
        count: 0,
        message: "Invalid or expired access token",
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

    try {
      console.log(
        `[LinkedIn Direct Post] Posting to account: ${
          account.username ?? account.id
        }`
      );

      // Call our API endpoint to post to LinkedIn
      const postResult = await postToLinkedIn({
        accessToken: validToken,
        memberUrn: memberUrn,
        text: accountContent.description,
        link: accountContent.link,
        mediaPath: mediaPath,
        mediaType: mediaType,
        fileName: fileName,
        userId: userId ?? "",
        buffer: config.buffer,
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

      if (postResult.success) {
        try {
          // Store content history
          await storeContentHistory(
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

          successCount = 1;
          console.log(
            `[LinkedIn Direct Post] Successfully posted to account and saved to history`
          );
        } catch (historyError) {
          console.error(
            `[LinkedIn Direct Post] Error saving to content history:`,
            historyError
          );
          // Still increment success since the post succeeded
          successCount = 1;
        }
      }
    } catch (postError) {
      console.error(
        `[LinkedIn Direct Post] Error for account ${account.id}:`,
        postError
      );
      return {
        success: false,
        count: 0,
        message: "Error posting to LinkedIn",
      };
    }

    return {
      success: true,
      count: successCount,
      message: `Successfully posted to ${successCount} LinkedIn account(s)`,
    };
  } catch (error) {
    console.error("[LinkedIn Direct Post] Error:", error);

    return {
      success: false,
      count: 0,
      message: `Failed to post to LinkedIn: `,
    };
  }
}
