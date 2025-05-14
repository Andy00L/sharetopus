"use server";
// createPostForm/action/directPostForLinkedInAccounts.ts
import { storeContentHistory } from "@/actions/server/contentHistoryActions/storeContentHistory";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { postToLinkedIn } from "@/lib/api/linkedin/post/postToLinkedIn";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { ScheduleResult } from "../Scheduled/scheduleForPinterestAccounts";

export async function directPostForLinkedInAccounts(config: {
  accounts: SocialAccount[]; // Changed from accounts to accountIds
  mediaPath: string;
  mediaType?: string;
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
  batchId: string;
  buffer?: Buffer;
}): Promise<ScheduleResult> {
  const {
    accounts,
    mediaPath,
    mediaType,
    accountContent,
    userId,
    batchId,
    fileName,
  } = config;

  if (!accounts || accounts.length === 0) {
    console.error("[LinkedIn Direct Post] Error fetching accounts:");

    return {
      success: false,
      count: 0,
      message: "Failed to fetch social accounts",
    };
  }

  let successCount = 0;

  try {
    console.log("[LinkedIn Direct Post] Starting to post directly to LinkedIn");

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

      // Vérifier et rafraîchir le token si nécessaire
      const validToken = await ensureValidToken(account);

      if (!validToken) {
        console.error(
          `[TikTok Direct Post] No valid access token for account ${account.id}`
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
          accessToken: validToken,
          memberUrn: memberUrn,
          text: content.description,
          link: content.link,
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
                content_id: postResult.postId,
                title: content.title ?? null,
                description: content.description,
                media_url: `https://www.linkedin.com/feed/update/${postResult.postId}`,
                batch_id: batchId,
                media_type: postType,
                status: "posted",
                social_account_id: content.accountId,
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
