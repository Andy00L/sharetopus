"use server";

import { authCheck } from "@/actions/authCheck";
import { deleteSupabaseFileAction } from "@/actions/server/data/deleteSupabaseFileAction";
import { checkRateLimit } from "@/actions/server/reddis/rate-limit";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { directPostForLinkedInAccounts } from "./Direct/directPostForLinkedInAccounts";
import { directPostForPinterestAccounts } from "./Direct/directPostForPinterestAccounts";
import { directPostForTikTokAccounts } from "./Direct/directPostForTikTokAccounts";
import { getMimeTypeFromFileName } from "./Direct/getMimeTypeFromFileName";
import { scheduleForLinkedInAccounts } from "./Scheduled/scheduledForLinkedinAccounts";
import { scheduleForPinterestAccounts } from "./Scheduled/scheduleForPinterestAccounts";
import { scheduleForTikTokAccounts } from "./Scheduled/scheduleForTikTokAccounts";

// Shared types for better code organization
type BoardInfo = {
  boardID: string;
  boardName: string;
  accountId: string;
  isSelected: boolean;
};

type ContentInfo = {
  accountId: string;
  title: string;
  description: string;
  link: string;
  isCustomized: boolean;
};

type PlatformCounts = {
  pinterest: number;
  linkedin: number;
  tiktok: number;
  total: number;
};

// Add a type for account-level errors
type AccountError = {
  accountId: string;
  platform: string;
  displayName: string;
  error: string;
};

type PostResult = {
  success: boolean;
  counts: PlatformCounts;
  message: string;
  errors?: AccountError[]; // Add detailed errors for failed accounts
  resetIn?: number; // Rate limit reset time
};

/**
 * Unified function to handle both direct posting and scheduling across different platforms
 * Processes all platforms in parallel for maximum performance with robust error handling
 * and comprehensive security checks.
 *
 * @param config Configuration object containing all necessary parameters
 * @returns Object with success status, platform-specific counts, and a user-friendly message
 */
export async function handleSocialMediaPost(config: {
  pinterestAccounts: SocialAccount[];
  linkedinAccounts: SocialAccount[];
  tiktokAccounts: SocialAccount[];
  mediaPath: string;
  fileName?: string;
  boards?: BoardInfo[];
  platformOptions: PlatformOptions;
  accountContent: ContentInfo[];
  isScheduled: boolean;
  scheduledDate?: string;
  scheduledTime?: string;
  postType: "image" | "video" | "text";
  userId: string | null;
  batchId: string;
  cleanupFiles?: boolean;
}): Promise<PostResult> {
  // Start tracking execution time
  const startTime = performance.now();

  const {
    pinterestAccounts,
    linkedinAccounts,
    tiktokAccounts,
    mediaPath,
    fileName,
    boards,
    platformOptions,
    accountContent,
    isScheduled,
    scheduledDate,
    scheduledTime,
    postType,
    userId,
    batchId,
    cleanupFiles = true,
  } = config;

  // Initialize results object
  const results: PostResult = {
    success: false,
    counts: {
      pinterest: 0,
      linkedin: 0,
      tiktok: 0,
      total: 0,
    },
    message: "",
    errors: [], // Track individual account errors
  };

  try {
    // Early validation: Check if there are any accounts to process
    const totalAccounts =
      pinterestAccounts.length +
      linkedinAccounts.length +
      tiktokAccounts.length;
    if (totalAccounts === 0) {
      console.error(
        `[handleSocialMediaPost]: No accounts provided for processing`
      );
      return {
        success: false,
        counts: results.counts,
        message:
          "No accounts selected for posting. Please select at least one account.",
        errors: [],
      };
    }

    console.log(
      `[handleSocialMediaPost]: Starting ${
        isScheduled ? "scheduled" : "direct"
      } post process for ${totalAccounts} total accounts`
    );

    // Step 1: Verify user is properly authenticated
    if (!userId) {
      console.error(`[handleSocialMediaPost]: Missing user ID in request`);
      return {
        success: false,
        counts: results.counts,
        message: "User authentication required. Please sign in to continue.",
        errors: [],
      };
    }

    // Verify user is properly authenticated
    const authResult = await authCheck(userId);
    if (!authResult) {
      console.error(
        `[handleSocialMediaPost]: Authentication check failed for user ID: ${userId}`
      );
      return {
        success: false,
        counts: results.counts,
        message: "Authentication validation failed. Please sign in again.",
        errors: [],
      };
    }

    console.log(
      `[handleSocialMediaPost]: Authentication validated for user: ${userId}`
    );

    // Step 2: Check rate limits to prevent abuse
    console.log(
      `[handleSocialMediaPost]: Checking rate limits for user: ${userId}`
    );
    const rateCheck = await checkRateLimit(
      "handleSocialMediaPost", // Unique identifier for this operation
      userId, // User identifier
      30, // Limit (30 requests)
      60 // Window (60 seconds)
    );
    if (!rateCheck.success) {
      console.warn(
        `[handleSocialMediaPost]: Rate limit exceeded for user: ${userId}. Reset in: ${
          rateCheck.resetIn ?? "unknown"
        } seconds`
      );
      return {
        success: false,
        counts: results.counts,
        message: "Too many requests. Please try again later.",
        resetIn: rateCheck.resetIn,
        errors: [],
      };
    }
    console.log(
      `[handleSocialMediaPost]: Rate limit check passed for user: ${userId}`
    );

    // Step 3: Pre-process media if needed - do this ONCE instead of in each platform handler
    let mediaType: string | undefined;

    if (mediaPath && fileName) {
      try {
        // Get media type and validate for all platforms at once
        mediaType = getMimeTypeFromFileName(fileName);
        console.log(
          `[handleSocialMediaPost]: Media type detected: ${mediaType}`
        );

        // Verify file type compatibility with platforms
        if (postType === "image" && tiktokAccounts.length > 0) {
          console.warn(
            "[handleSocialMediaPost]: TikTok does not support image posts"
          );

          // Add warning to errors array
          results.errors?.push({
            accountId: "multiple",
            platform: "tiktok",
            displayName: "All TikTok Accounts",
            error: "TikTok does not support image posts",
          });
        }
      } catch (fileError) {
        console.error(
          `[handleSocialMediaPost]: Error processing file:`,
          fileError
        );

        // Clean up file on error if needed
        if (cleanupFiles) {
          try {
            await deleteSupabaseFileAction(userId, mediaPath, true);
            console.log(
              `[handleSocialMediaPost]: Cleaned up media file after error: ${mediaPath}`
            );
          } catch (cleanupError) {
            console.error(
              `[handleSocialMediaPost]: Failed to clean up media file:`,
              cleanupError
            );
          }
        }

        return {
          success: false,
          counts: results.counts,
          message:
            "Failed to process media file. Please try again with a different file.",
          errors: [
            {
              accountId: "none",
              platform: "system",
              displayName: "Media Processing",
              error:
                fileError instanceof Error
                  ? fileError.message
                  : String(fileError),
            },
          ],
        };
      }
    } else if (
      (postType === "image" || postType === "video") &&
      (pinterestAccounts.length > 0 ||
        (tiktokAccounts.length > 0 && postType === "video"))
    ) {
      // Validate media requirements by platform
      console.error(
        `[handleSocialMediaPost]: Media required for ${postType} posts on Pinterest/TikTok`
      );
      return {
        success: false,
        counts: results.counts,
        message: `${postType} posts require media files for Pinterest${
          postType === "video" ? " and TikTok" : ""
        }`,
        errors: [],
      };
    }

    // Step 4: Verify content for each account
    const missingContentAccounts: AccountError[] = [];

    // Check Pinterest accounts
    pinterestAccounts.forEach((account) => {
      const content = accountContent.find((c) => c.accountId === account.id);
      if (!content) {
        missingContentAccounts.push({
          accountId: account.id,
          platform: "pinterest",
          displayName: account.display_name || account.username || account.id,
          error: "No content configured for this account",
        });
      }

      // For Pinterest, also verify board selection
      if (postType !== "text" && content) {
        const hasSelectedBoard = boards?.some(
          (b) => b.accountId === account.id && b.isSelected
        );
        if (!hasSelectedBoard) {
          missingContentAccounts.push({
            accountId: account.id,
            platform: "pinterest",
            displayName: account.display_name || account.username || account.id,
            error: "No board selected for this account",
          });
        }
      }
    });

    // Check LinkedIn accounts
    linkedinAccounts.forEach((account) => {
      const content = accountContent.find((c) => c.accountId === account.id);
      if (!content) {
        missingContentAccounts.push({
          accountId: account.id,
          platform: "linkedin",
          displayName: account.display_name || account.username || account.id,
          error: "No content configured for this account",
        });
      }

      // Verify LinkedIn-specific requirements
      if (!account.account_identifier) {
        missingContentAccounts.push({
          accountId: account.id,
          platform: "linkedin",
          displayName: account.display_name || account.username || account.id,
          error: "No LinkedIn identifier found for this account",
        });
      }
    });

    // Check TikTok accounts
    tiktokAccounts.forEach((account) => {
      if (postType === "image") {
        // Skip checking TikTok accounts for image posts
        return;
      }

      const content = accountContent.find((c) => c.accountId === account.id);
      if (!content) {
        missingContentAccounts.push({
          accountId: account.id,
          platform: "tiktok",
          displayName: account.display_name || account.username || account.id,
          error: "No content configured for this account",
        });
      }
    });

    // Return early if any accounts are missing required configuration
    if (missingContentAccounts.length > 0) {
      results.errors = missingContentAccounts;
      console.error(
        `[handleSocialMediaPost]: ${missingContentAccounts.length} accounts have invalid configuration`
      );

      return {
        success: false,
        counts: results.counts,
        message:
          "Some accounts have invalid configuration. Please check your settings.",
        errors: missingContentAccounts,
      };
    }

    // Step 5: ENHANCED ERROR HANDLING: Process each platform's accounts individually
    // Log start time of processing
    const processingStartTime = performance.now();
    console.log(
      `[handleSocialMediaPost]: Starting parallel account processing`
    );

    // Process each platform in parallel for maximum performance
    const [
      tiktokAccountResults,
      pinterestAccountResults,
      linkedinAccountResults,
    ] = await Promise.all([
      // Process TikTok accounts (if any and not image posts)
      tiktokAccounts.length > 0 && postType !== "image"
        ? processTiktokAccounts({
            accounts: tiktokAccounts,
            mediaPath,
            fileName: fileName || "",
            platformOptions,
            accountContent,
            isScheduled,
            scheduledDate: scheduledDate || "",
            scheduledTime: scheduledTime || "",
            postType,
            userId,
            batchId,
          })
        : Promise.resolve({ successCount: 0, errors: [] }),

      // Process Pinterest accounts (if any and not text posts)
      pinterestAccounts.length > 0 && postType !== "text"
        ? processPinterestAccounts({
            accounts: pinterestAccounts,
            mediaPath,
            fileName: fileName || "",
            boards: boards || [],
            platformOptions,
            accountContent,
            isScheduled,
            scheduledDate: scheduledDate || "",
            scheduledTime: scheduledTime || "",
            postType,
            userId,
            batchId,
          })
        : Promise.resolve({ successCount: 0, errors: [] }),

      // Process LinkedIn accounts (if any)
      linkedinAccounts.length > 0
        ? processLinkedinAccounts({
            accounts: linkedinAccounts,
            mediaPath,
            fileName: fileName || "",
            platformOptions,
            accountContent,
            isScheduled,
            scheduledDate: scheduledDate || "",
            scheduledTime: scheduledTime || "",
            postType,
            userId,
            batchId,
          })
        : Promise.resolve({ successCount: 0, errors: [] }),
    ]);

    // Log processing time
    const processingTime = performance.now() - processingStartTime;
    console.log(
      `[handleSocialMediaPost]: Parallel processing completed in ${processingTime.toFixed(
        2
      )}ms`
    );

    // Step 6: Collect all account-level errors
    results.errors = [
      ...tiktokAccountResults.errors,
      ...pinterestAccountResults.errors,
      ...linkedinAccountResults.errors,
    ];

    // Collect success counts
    results.counts.pinterest = pinterestAccountResults.successCount;
    results.counts.linkedin = linkedinAccountResults.successCount;
    results.counts.tiktok = tiktokAccountResults.successCount;
    results.counts.total =
      results.counts.pinterest +
      results.counts.linkedin +
      results.counts.tiktok;

    // Mark success if ANY account succeeded
    results.success = results.counts.total > 0;

    // Log account-level failures for debugging
    if (results.errors.length > 0) {
      console.log(
        `[handleSocialMediaPost]: ${results.errors.length} account-level errors occurred:`
      );
      results.errors.forEach((err, index) => {
        console.log(
          `  [${index + 1}] ${err.platform}/${err.displayName}: ${err.error}`
        );
      });
    }

    // Step 7: Clean up media file if direct posting and cleanup is requested
    if (!isScheduled && cleanupFiles && mediaPath) {
      try {
        await deleteSupabaseFileAction(userId, mediaPath, true);
        console.log(
          `[handleSocialMediaPost]: Cleaned up temporary media file: ${mediaPath}`
        );
      } catch (cleanupError) {
        console.error(
          `[handleSocialMediaPost]: Error cleaning up media file:`,
          cleanupError
        );
        // Continue with success response even if cleanup fails
      }
    }

    // Step 8: Generate appropriate success message
    results.message = generateSuccessMessage(
      results.counts,
      isScheduled,
      results.errors.length
    );

    // Step 9: Log total processing time for performance monitoring
    const totalTime = performance.now() - startTime;
    console.log(
      `[handleSocialMediaPost]: Total processing completed in ${totalTime.toFixed(
        2
      )}ms with ${results.counts.total} successes and ${
        results.errors.length
      } failures`
    );

    // If there were no successful posts but we didn't catch it earlier, ensure success is false
    if (results.counts.total === 0) {
      results.success = false;
      if (results.message === "") {
        results.message = "No posts were processed successfully.";
      }
    }

    return results;
  } catch (error) {
    // Step 10: Handle unexpected errors with detailed logging
    console.error(`[handleSocialMediaPost]: Unexpected error:`, error);
    console.error(
      error instanceof Error ? error.stack : "No stack trace available"
    );

    // Clean up media on error for direct posts
    if (!isScheduled && cleanupFiles && mediaPath) {
      try {
        await deleteSupabaseFileAction(userId, mediaPath, true);
        console.log(
          `[handleSocialMediaPost]: Cleaned up media file after unexpected error`
        );
      } catch (cleanupError) {
        console.error(
          `[handleSocialMediaPost]: Error cleaning up media file after error:`,
          cleanupError
        );
      }
    }

    return {
      success: false,
      counts: results.counts,
      message:
        error instanceof Error
          ? `An error occurred: ${error.message.substring(0, 100)}${
              error.message.length > 100 ? "..." : ""
            }`
          : `An unexpected error occurred. Please try again.`,
      errors: [
        {
          accountId: "none",
          platform: "system",
          displayName: "System Error",
          error: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

/**
 * Process TikTok accounts individually with robust error handling for each account
 */
async function processTiktokAccounts(config: {
  accounts: SocialAccount[];
  mediaPath: string;
  fileName: string;
  platformOptions: PlatformOptions;
  accountContent: ContentInfo[];
  isScheduled: boolean;
  scheduledDate: string;
  scheduledTime: string;
  postType: "image" | "video" | "text";
  userId: string | null;
  batchId: string;
}) {
  const { accounts, isScheduled, postType } = config;
  const errors: AccountError[] = [];
  let successCount = 0;

  // Skip if no accounts or incompatible post type
  if (accounts.length === 0 || postType === "image") {
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
        throw new Error("No content configured for this account");
      }

      // Process single account with detailed timing
      const accountStartTime = performance.now();
      const result = isScheduled
        ? await scheduleForTikTokAccounts({
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
        : await directPostForTikTokAccounts({
            accounts: [account],
            mediaPath: config.mediaPath,
            platformOptions: config.platformOptions,
            accountContent: [accountContent],
            userId: config.userId,
            fileName: config.fileName,
            batchId: config.batchId,
            cleanupFiles: false,
          });

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
            displayName: account.display_name || account.username || account.id,
            error: result.message || "Failed to process account",
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
    `[processTiktokAccounts]: Completed with ${successCount} successes and ${errors.length} failures`
  );
  return { successCount, errors };
}

/**
 * Process Pinterest accounts individually with robust error handling for each account
 */
async function processPinterestAccounts(config: {
  accounts: SocialAccount[];
  mediaPath: string;
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
        throw new Error("No content configured for this account");
      }

      // Find board for this account
      const accountBoards = config.boards.filter(
        (b) => b.accountId === account.id && b.isSelected
      );
      if (accountBoards.length === 0) {
        throw new Error("No board selected for this account");
      }

      // Process single account with detailed timing
      const accountStartTime = performance.now();
      const result = isScheduled
        ? await scheduleForPinterestAccounts({
            accounts: [account],
            mediaPath: config.mediaPath,
            boards: accountBoards,
            platformOptions: config.platformOptions,
            accountContent: [accountContent],
            scheduledDate: config.scheduledDate,
            scheduledTime: config.scheduledTime,
            postType: config.postType,
            userId: config.userId,
            batchId: config.batchId,
          })
        : await directPostForPinterestAccounts({
            accounts: [account],
            mediaPath: config.mediaPath,
            boards: accountBoards,
            platformOptions: config.platformOptions,
            accountContent: [accountContent],
            userId: config.userId,
            fileName: config.fileName,
            batchId: config.batchId,
            cleanupFiles: false,
          });

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

/**
 * Process LinkedIn accounts individually with robust error handling for each account
 */
async function processLinkedinAccounts(config: {
  accounts: SocialAccount[];
  mediaPath: string;
  fileName: string;
  platformOptions: PlatformOptions;
  accountContent: ContentInfo[];
  isScheduled: boolean;
  scheduledDate: string;
  scheduledTime: string;
  postType: "image" | "video" | "text";
  userId: string | null;
  batchId: string;
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
          account.display_name || account.username || account.id
        }`
      );

      // Find content for this account
      const accountContent = config.accountContent.find(
        (c) => c.accountId === account.id
      );
      if (!accountContent) {
        throw new Error("No content configured for this account");
      }

      // Verify LinkedIn account has identifier
      if (!account.account_identifier) {
        throw new Error("No LinkedIn identifier found for this account");
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
            accounts: [account],
            mediaPath: config.mediaPath,
            platformOptions: config.platformOptions,
            accountContent: [accountContent],
            userId: config.userId,
            fileName: config.fileName,
            batchId: config.batchId,
            cleanupFiles: false,
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
            displayName: account.display_name || account.username || account.id,
            error: result.message || "Failed to process account",
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
    `[processLinkedinAccounts]: Completed with ${successCount} successes and ${errors.length} failures`
  );
  return { successCount, errors };
}

/**
 * Generate a user-friendly success message based on the results
 */
function generateSuccessMessage(
  counts: PlatformCounts,
  isScheduled: boolean,
  errorCount: number
): string {
  if (counts.total === 0) {
    return "No posts were processed successfully. Please check your account selections and try again.";
  }

  const action = isScheduled ? "scheduled" : "published";
  const platforms: string[] = [];

  if (counts.pinterest > 0) {
    platforms.push(`${counts.pinterest} on Pinterest`);
  }
  if (counts.linkedin > 0) {
    platforms.push(`${counts.linkedin} on LinkedIn`);
  }
  if (counts.tiktok > 0) {
    platforms.push(`${counts.tiktok} on TikTok`);
  }

  // Format message based on how many platforms were used
  let message = "";
  if (platforms.length === 1) {
    message = `${counts.total} post${counts.total > 1 ? "s" : ""} ${
      platforms[0]
    }`;
  } else if (platforms.length === 2) {
    message = `${counts.total} posts (${platforms.join(" and ")})`;
  } else if (platforms.length === 3) {
    message = `${counts.total} posts (${platforms[0]}, ${platforms[1]}, and ${platforms[2]})`;
  }

  // Add information about failures if any
  if (errorCount > 0) {
    message += ` with ${errorCount} failed account${errorCount > 1 ? "s" : ""}`;
  }

  return `Successfully ${action} ${message}`;
}
