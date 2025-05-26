import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { directPostForLinkedInAccounts } from "../Direct/directPostForLinkedInAccounts";
import { AccountError, ContentInfo } from "../handleSocialMediaPost";
import { scheduleForLinkedInAccounts } from "../Scheduled/scheduledForLinkedinAccounts";

/**
 * Process LinkedIn accounts individually with robust error handling for each account
 */
export async function processLinkedinAccounts(config: {
  accounts: SocialAccount[];
  mediaPath: string;
  mediaType: string;
  fileName: string;
  platformOptions: PlatformOptions;
  accountContent: ContentInfo[];
  isScheduled: boolean;
  scheduledDate: string;
  scheduledTime: string;
  postType: "image" | "video" | "text";
  userId: string | null;
  batchId: string;
  buffer?: Buffer;
  
  isCronJob?: boolean;
}) {
  const { accounts, isScheduled } = config;
  const errors: AccountError[] = [];
  let successCount = 0;

  // Skip if no accounts
  if (accounts.length === 0) {
    return { successCount, errors };
  }

  console.log(
    `[processLinkedinAccounts]: Processing ${accounts.length} LinkedIn accounts`
  );

  // Process accounts in parallel for maximum performance
  const accountPromises = accounts.map(async (account) => {
    try {
      console.log(
        `[processLinkedinAccounts]: Processing account: ${
          account.display_name ?? account.username ?? account.id
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
            platform: "linkedin",
            displayName: account.display_name ?? account.username ?? account.id,
            error: "No content configured for this account",
          },
        };
      }

      // Verify LinkedIn account has identifier
      if (!account.account_identifier) {
        return {
          success: false,
          error: {
            accountId: account.id,
            platform: "linkedin",
            displayName: account.display_name ?? account.username ?? account.id,
            error: "No LinkedIn identifier found for this account",
          },
        };
      }

      // Process single account with detailed timing
      const accountStartTime = performance.now();
      const result = isScheduled
        ? await scheduleForLinkedInAccounts({
            accounts: [account],
            mediaPath: config.mediaPath,
            platformOptions: config.platformOptions,
            accountContent: [accountContent],
            scheduledDate: config.scheduledDate,
            scheduledTime: config.scheduledTime,
            postType: config.postType,
            userId: config.userId,
            batchId: config.batchId,
          })
        : await directPostForLinkedInAccounts({
            account: account,
            mediaPath: config.mediaPath,
            mediaType: config.mediaType,
            platformOptions: config.platformOptions,
            accountContent: accountContent,
            postType: config.postType,
            userId: config.userId,
            fileName: config.fileName,
            batchId: config.batchId,
            buffer: config.buffer,
            cleanupFiles: false,
            isCronJob: config.isCronJob,
          });

      const accountProcessingTime = performance.now() - accountStartTime;
      console.log(
        `[processLinkedinAccounts]: Processed account ${
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
            platform: "Linkedin",
            displayName: account.display_name ?? account.username ?? account.id,
            error: result.message ?? "Failed to process account",
          },
        };
      }
    } catch (error) {
      // Record account-level error but don't stop other accounts
      console.error(
        `[processLinkedinAccounts]: Error processing account ${account.id}:`,
        error
      );
      return {
        success: false,
        error: {
          accountId: account.id,
          platform: "linkedin",
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
    `[processLinkedinAccounts]: Completed with ${successCount} successes and ${errors.length} failures`
  );
  return { successCount, errors };
}
