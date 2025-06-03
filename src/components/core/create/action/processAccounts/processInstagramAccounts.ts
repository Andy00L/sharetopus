import { SocialAccount } from "@/lib/types/dbTypes";
import { directPostForInstagramAccounts } from "../Direct/directPostForInstagramAccounts";
import { AccountError, ContentInfo } from "../handleSocialMediaPost";
import { scheduleForInstagramAccounts } from "../Scheduled/scheduleForInstagramAccounts";

/**
 * Process Instagram accounts individually with robust error handling for each account
 */
export async function processInstagramAccounts(config: {
  accounts: SocialAccount[];
  mediaPath: string;
  mediaUrl?: string;
  coverTimestamp: number;
  mediaType: string;
  fileName: string;
  accountContent: ContentInfo[];
  isScheduled: boolean;
  scheduledDate: string;
  scheduledTime: string;
  postType: "image" | "video";
  userId: string | null;
  batchId: string;
  isCronJob?: boolean;
}) {
  const { accounts, isScheduled, postType } = config;
  const errors: AccountError[] = [];
  let successCount = 0;

  // Validate we have a URL for Instagram
  if (!config.mediaUrl) {
    console.error(
      "[processInstagramAccounts] No media URL provided for Instagram"
    );
    return {
      successCount: 0,
      errors: accounts.map((account) => ({
        accountId: account.id,
        platform: "instagram",
        displayName: account.display_name || account.username || account.id,
        error: "No public media URL available for Instagram",
      })),
    };
  }

  // Skip if no accounts or incompatible post type
  if (accounts.length === 0) {
    return { successCount, errors };
  }

  console.log(
    `[processInstagramAccounts]: Processing ${accounts.length} Instagram accounts`
  );

  // Process accounts in parallel for maximum performance
  const accountPromises = accounts.map(async (account) => {
    try {
      console.log(
        `[processInstagramAccounts]: Processing account: ${
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
            platform: "instagram",
            displayName: account.display_name || account.username || account.id,
            error: "No content configured for this account",
          },
        };
      }

      // Validate Instagram-specific requirements
      if (!account.access_token) {
        return {
          success: false,
          error: {
            accountId: account.id,
            platform: "instagram",
            displayName: account.display_name || account.username || account.id,
            error: "Missing Instagram access token",
          },
        };
      }

      if (!account.account_identifier) {
        return {
          success: false,
          error: {
            accountId: account.id,
            platform: "instagram",
            displayName: account.display_name || account.username || account.id,
            error: "Missing Instagram Business/Creator account ID",
          },
        };
      }

      // Process single account with detailed timing
      const accountStartTime = performance.now();
      const result = isScheduled
        ? await scheduleForInstagramAccounts({
            account: account,
            mediaPath: config.mediaPath,
            coverTimestamp: config.coverTimestamp,
            accountContent: accountContent,
            scheduledDate: config.scheduledDate,
            scheduledTime: config.scheduledTime,
            postType: config.postType,
            userId: config.userId,
            batchId: config.batchId,
          })
        : await directPostForInstagramAccounts({
            account: account,
            mediaPath: config.mediaPath,
            coverTimestamp: config.coverTimestamp,
            mediaType: config.mediaType,
            mediaUrl: config.mediaUrl!,
            postType,
            accountContent: accountContent,
            userId: config.userId,
            fileName: config.fileName,
            batchId: config.batchId,
            isCronJob: config.isCronJob,
          });

      const accountProcessingTime = performance.now() - accountStartTime;
      console.log(
        `[processInstagramAccounts]: Processed account ${
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
            platform: "instagram",
            displayName: account.display_name ?? account.username ?? account.id,
            error: result.message ?? "Failed to process account",
          },
        };
      }
    } catch (error) {
      // Record account-level error but don't stop other accounts
      console.error(
        `[processInstagramAccounts]: Error processing account ${account.id}:`,
        error
      );
      return {
        success: false,
        error: {
          accountId: account.id,
          platform: "instagram",
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
    `[processInstagramAccounts]: Completed with ${successCount} successes and ${errors.length} failures`
  );
  return { successCount, errors };
}
