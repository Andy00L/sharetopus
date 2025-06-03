import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { AccountError, BoardInfo, ContentInfo } from "../handleSocialMediaPost";
import { scheduleForPinterestAccount } from "../Scheduled/scheduleForPinterestAccounts";

/**
 * Process Pinterest accounts individually with robust error handling for each account
 */
export async function processPinterestAccounts(config: {
  accounts: SocialAccount[];
  mediaPath: string;
  coverTimestamp: number;
  mediaType: string;
  fileName: string;
  boards: BoardInfo[];
  platformOptions: PlatformOptions;
  accountContent: ContentInfo[];
  isScheduled: boolean;
  scheduledDate: string;
  scheduledTime: string;
  postType: "image" | "video" | "text";
  userId: string | null;
  batchId: string;
  isCronJob?: boolean;
}) {
  const { accounts, isScheduled, postType } = config;
  const errors: AccountError[] = [];
  let successCount = 0;

  // Skip if no accounts or incompatible post type
  if (accounts.length === 0 || postType === "text") {
    return { successCount, errors };
  }

  console.log(
    `[processPinterestAccounts]: Processing ${accounts.length} Pinterest accounts`
  );

  // Process accounts in parallel for maximum performance
  const accountPromises = accounts.map(async (account) => {
    try {
      console.log(
        `[processPinterestAccounts]: Processing account: ${
          account.display_name || account.username || account.id
        }`
      );

      // Find content for this account
      const accountContent = config.accountContent.find(
        (c) => c.accountId === account.id
      );
      if (!accountContent) {
        return {
          success: false,
          error: {
            accountId: account.id,
            platform: "pinterest",
            displayName: account.display_name || account.username || account.id,
            error: "No content configured for this account",
          },
        };
      }

      // Find board for this account
      const accountBoards = config.boards.filter(
        (b) => b.accountId === account.id && b.isSelected
      );

      if (accountBoards.length === 0) {
        return {
          success: false,
          error: {
            accountId: account.id,
            platform: "pinterest",
            displayName: account.display_name || account.username || account.id,
            error: "No board selected for this account",
          },
        };
      }

      // Process single account with detailed timing
      const accountStartTime = performance.now();
      const result = isScheduled
        ? await scheduleForPinterestAccount({
            account: account,
            mediaPath: config.mediaPath,
            coverTimestamp: config.coverTimestamp,

            boards: accountBoards[0],
            platformOptions: config.platformOptions,
            accountContent: accountContent,
            scheduledDate: config.scheduledDate,
            scheduledTime: config.scheduledTime,
            postType: config.postType,
            userId: config.userId,
            batchId: config.batchId,
          })
        : await fetch("/api/social/post/pinterest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account: account,
              mediaPath: config.mediaPath,
              coverTimestamp: config.coverTimestamp,

              mediaType: config.mediaType,
              boards: accountBoards[0],
              platformOptions: config.platformOptions,
              accountContent: accountContent,
              userId: config.userId,
              fileName: config.fileName,
              batchId: config.batchId,
              postType: config.postType,
              isCronJob: config.isCronJob,
            }),
          }).then((res) => res.json());

      const accountProcessingTime = performance.now() - accountStartTime;
      console.log(
        `[processPinterestAccounts]: Processed account ${
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
            platform: "Pinterest",
            displayName: account.display_name || account.username || account.id,
            error: result.message || "Failed to process account",
          },
        };
      }
    } catch (error) {
      // Record account-level error but don't stop other accounts
      console.error(
        `[processPinterestAccounts]: Error processing account ${account.id}:`,
        error
      );
      return {
        success: false,
        error: {
          accountId: account.id,
          platform: "pinterest",
          displayName: account.display_name || account.username || account.id,
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
    `[processPinterestAccounts]: Completed with ${successCount} successes and ${errors.length} failures`
  );
  return { successCount, errors };
}
