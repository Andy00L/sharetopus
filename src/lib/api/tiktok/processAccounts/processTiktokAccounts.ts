import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import {
  AccountError,
  ContentInfo,
} from "../../../../components/core/create/action/handleSocialMediaPost/handleSocialMediaPost";
import { scheduleForTikTokAccounts } from "../schedule/scheduleForTikTokAccounts";

/**
 * Process TikTok accounts individually with robust error handling for each account
 */
export async function processTiktokAccounts(config: {
  accounts: SocialAccount[];
  mediaPath: string;
  coverTimestamp: number;
  mediaType: string;
  fileName: string;
  tiktokMediaUrl: string;
  platformOptions: PlatformOptions;
  accountContent: ContentInfo[];
  isScheduled: boolean;
  scheduledDate: string;
  scheduledTime: string;
  postType: "image" | "video" | "text";
  userId: string | null;
  batchId: string;
  cronSecret: string | undefined;
}) {
  const { accounts, isScheduled, postType } = config;
  const errors: AccountError[] = [];
  let successCount = 0;

  // Skip if no accounts or incompatible post type
  if (accounts.length === 0) {
    return { successCount, errors };
  }

  console.log(
    `[processTiktokAccounts]: Processing ${accounts.length} TikTok accounts`
  );

  // Process accounts in parallel for maximum performance
  const accountPromises = accounts.map(async (account) => {
    try {
      console.log(
        `[processTiktokAccounts]: Processing account: ${
          account.display_name || account.username || account.id
        }`
      );

      // Find content for this account

      const accountContent = config.accountContent.find(
        (c) => c.accountId === account.id
      );

      if (!accountContent) {
        console.error("No content configured for this account");
        return {
          success: false,
          error: {
            accountId: account.id,
            platform: "tiktok",
            displayName: account.display_name || account.username || account.id,
            error: "No content configured for this account",
          },
        };
      }

      // Process single account with detailed timing
      const accountStartTime = performance.now();
      const result = isScheduled
        ? await scheduleForTikTokAccounts({
            account: account,
            mediaPath: config.mediaPath,
            coverTimestamp: config.coverTimestamp,
            platformOptions: config.platformOptions,
            accountContent: accountContent,
            scheduledDate: config.scheduledDate,
            scheduledTime: config.scheduledTime,
            postType: config.postType,
            userId: config.userId,
            batchId: config.batchId,
          })
        : await fetch(`${process.env.FRONTEND_URL}/api/social/post/tiktok`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account: account,
              mediaPath: config.mediaPath,
              coverTimestamp: config.coverTimestamp,
              mediaType: config.mediaType,
              postType,
              tiktokMediaUrl: config.tiktokMediaUrl,
              platformOptions: config.platformOptions,
              accountContent: accountContent,
              userId: config.userId,
              fileName: config.fileName,
              batchId: config.batchId,
              isCronJob: config.cronSecret,
            }),
          }).then((res) => res.json());

      const accountProcessingTime = performance.now() - accountStartTime;
      console.log(
        `[processTiktokAccounts]: Processed account ${
          account.id
        } in ${accountProcessingTime.toFixed(2)}ms: ${
          result.success ? "Success" : "Failed"
        }`
      );

      // Add to success count if successful
      if (result.success && result.count > 0) {
        return { success: true };
      } else {
        return {
          success: false,
          error: {
            accountId: account.id,
            platform: "Tiktok",
            displayName: account.display_name ?? account.username ?? account.id,
            error: result.message ?? "Failed to process account",
          },
        };
      }
    } catch (error) {
      // Record account-level error but don't stop other accounts
      console.error(
        `[processTiktokAccounts]: Error processing account ${account.id}:`,
        error
      );
      return {
        success: false,
        error: {
          accountId: account.id,
          platform: "tiktok",
          displayName: account.display_name ?? account.username ?? account.id,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });

  // Wait for all account processing to complete
  const results = await Promise.all(accountPromises);

  // Count successes and collect errors
  results.forEach((result) => {
    if (result.success) {
      successCount++;
    } else if (result.error) {
      errors.push(result.error);
    }
  });

  console.log(
    `[processTiktokAccounts]: Completed with ${successCount} successes and ${errors.length} failures`
  );
  return { successCount, errors };
}
