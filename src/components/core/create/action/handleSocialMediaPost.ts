"use server";

import { authCheck } from "@/actions/authCheck";
import { deleteSupabaseFileAction } from "@/actions/server/data/deleteSupabaseFileAction";
import { getSupabaseVideoFile } from "@/actions/server/data/getSupabaseVideoFile";
import { checkRateLimit } from "@/actions/server/reddis/rate-limit";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { getMimeTypeFromFileName } from "./Direct/getMimeTypeFromFileName";
import { processLinkedinAccounts } from "./processAccounts/processLinkedinAccounts";
import { processPinterestAccounts } from "./processAccounts/processPinterestAccounts";
import { processTiktokAccounts } from "./processAccounts/processTiktokAccounts";

// Shared types for better code organization
export type BoardInfo = {
  boardID: string;
  boardName: string;
  accountId: string;
  isSelected: boolean;
};

export type ContentInfo = {
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
export type AccountError = {
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
  isCronJob?: boolean;
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

    // Verify user is properly authenticated
    const authResult = await authCheck(userId, {
      isCronJob: config.isCronJob,
      cronSecret: process.env.CRON_SECRET_KEY,
    });
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

    // Step 2: Check rate limits to prevent abuse
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

    // Step 3: Pre-process media if needed - do this ONCE instead of in each platform handler
    let mediaType: string = "";

    if (mediaPath && fileName) {
      try {
        // Get media type and validate for all platforms at once
        mediaType = getMimeTypeFromFileName(fileName);

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
          displayName: account.display_name ?? account.username ?? account.id,
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
            displayName: account.display_name ?? account.username ?? account.id,
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
          displayName: account.display_name ?? account.username ?? account.id,
          error: "No content configured for this account",
        });
      }

      // Verify LinkedIn-specific requirements
      if (!account.account_identifier) {
        missingContentAccounts.push({
          accountId: account.id,
          platform: "linkedin",
          displayName: account.display_name ?? account.username ?? account.id,
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
          displayName: account.display_name ?? account.username ?? account.id,
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
    let responseBuffer;

    if (mediaPath && (postType === "video" || postType === "image")) {
      // Download the file for direct upload
      responseBuffer = await getSupabaseVideoFile(mediaPath, userId);
      if (!responseBuffer.success) {
        return {
          success: false,
          counts: results.counts,
          message: responseBuffer.message,
          errors: [],
        };
      }
    }

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
            mediaType,
            fileName: fileName ?? "",
            platformOptions,
            accountContent,
            isScheduled,
            scheduledDate: scheduledDate ?? "",
            scheduledTime: scheduledTime ?? "",
            postType,
            buffer: responseBuffer?.buffer,
            userId,
            batchId,
          })
        : Promise.resolve({ successCount: 0, errors: [] }),

      // Process Pinterest accounts (if any and not text posts)
      pinterestAccounts.length > 0 && postType !== "text"
        ? processPinterestAccounts({
            accounts: pinterestAccounts,
            mediaPath,
            mediaType,
            fileName: fileName ?? "",
            boards: boards || [],
            platformOptions,
            accountContent,
            isScheduled,
            scheduledDate: scheduledDate ?? "",
            scheduledTime: scheduledTime ?? "",
            buffer: responseBuffer?.buffer,
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
            fileName: fileName ?? "",
            platformOptions,
            accountContent,
            isScheduled,
            scheduledDate: scheduledDate ?? "",
            scheduledTime: scheduledTime ?? "",
            postType,
            userId,
            batchId,
            buffer: responseBuffer?.buffer,
            mediaType,
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
