"use server";

import { getSignedViewUrl } from "@/actions/client/getSignedViewUrl";
import { createSecureMediaUrlSigned } from "@/actions/client/mediaURL";
import { authCheck } from "@/actions/server/authCheck";
import { authCheckCronJob } from "@/actions/server/authCheckCronJob";
import { deleteSupabaseFileAction } from "@/actions/server/data/deleteSupabaseFileAction";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { getMimeTypeFromFileName } from "./Direct/getMimeTypeFromFileName";

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
  instagram: number;
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
  instagramAccounts: SocialAccount[];
  mediaPath: string;
  coverTimestamp: number;
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
  cronSecret?: string | undefined;
}): Promise<PostResult> {
  // Start tracking execution time
  const startTime = performance.now();
  const {
    pinterestAccounts,
    linkedinAccounts,
    tiktokAccounts,
    instagramAccounts,
    mediaPath,
    coverTimestamp,
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
    cronSecret,
  } = config;

  // Initialize results object
  const results: PostResult = {
    success: false,
    counts: {
      pinterest: 0,
      linkedin: 0,
      tiktok: 0,
      instagram: 0,
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
      instagramAccounts.length +
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
    const authResult = cronSecret
      ? await authCheckCronJob(userId, cronSecret)
      : await authCheck(userId);

    if (!authResult) {
      const errorMessage = cronSecret
        ? "Cron job authentication failed. Invalid secret key."
        : "Authentication validation failed. Please sign in again.";

      console.error(
        `[handleSocialMediaPost]: Authentication failed for user ID: ${userId}`
      );

      return {
        success: false,
        counts: results.counts,
        message: errorMessage,
        errors: [],
      };
    }

    // Step 2: Check rate limits to prevent abuse
    const rateCheck = await checkRateLimit(
      "handleSocialMediaPost", // Unique identifier for this operation
      userId, // User identifier
      30, // Limit (30 requests)
      60, // Window (60 seconds),
      cronSecret
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

    // Early return if media is missing but required
    const requiresMedia =
      (postType === "image" || postType === "video") &&
      (pinterestAccounts.length > 0 ||
        (tiktokAccounts.length > 0 && postType === "video"));

    if (!mediaPath && requiresMedia) {
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

    // Process media file if provided
    if (mediaPath && fileName) {
      const mimeResult = getMimeTypeFromFileName(fileName);

      if (!mimeResult.success) {
        console.error(
          `[handleSocialMediaPost]: Error processing file: ${mimeResult.message}`
        );

        // Clean up file on error if needed
        if (cleanupFiles) {
          try {
            await deleteSupabaseFileAction(userId, mediaPath, true, cronSecret);
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
          message: mimeResult.message || "Failed to process media file.",
          errors: [
            {
              accountId: "none",
              platform: "system",
              displayName: "Media Processing",
              error: mimeResult.message || "Unknown file type error",
            },
          ],
        };
      }

      mediaType = mimeResult.mimeType;
    }

    // Step 4: Verify content for each account
    const missingContentAccounts: AccountError[] = [
      ...validateAccountContent(
        pinterestAccounts,
        accountContent,
        "pinterest",
        boards,
        postType
      ),
      ...validateAccountContent(linkedinAccounts, accountContent, "linkedin"),
      ...validateAccountContent(tiktokAccounts, accountContent, "tiktok"),
      ...validateAccountContent(instagramAccounts, accountContent, "instagram"),
    ];

    if (missingContentAccounts.length > 0) {
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

    let mediaUrl;
    let tiktokMediaUrl;

    // Generate TikTok proxy URL if we have TikTok accounts
    if (tiktokAccounts.length > 0 && mediaPath && !isScheduled) {
      tiktokMediaUrl = createSecureMediaUrlSigned(mediaPath, userId!);
      console.log(
        `[handleSocialMediaPost] TikTok proxy URL created for ${tiktokAccounts.length} accounts`
      );
    }

    // Generate regular signed URL for non-TikTok platforms (Instagram, LinkedIn, Pinterest)
    const hasNonTikTokPlatforms =
      instagramAccounts.length > 0 ||
      linkedinAccounts.length > 0 ||
      pinterestAccounts.length > 0;

    if (
      !isScheduled &&
      hasNonTikTokPlatforms &&
      mediaPath &&
      (postType === "video" || postType === "image")
    ) {
      const expiresIn = 300; // 5 minutes
      const signedUrlResult = await getSignedViewUrl(
        mediaPath,
        userId!,
        expiresIn
      );

      if (!signedUrlResult.success) {
        console.error(
          `[handleSocialMediaPost] Failed to create signed URL: ${signedUrlResult.message}`
        );
        return {
          success: false,
          counts: results.counts,
          message: signedUrlResult.message,
          errors: [],
        };
      }

      mediaUrl = signedUrlResult.url;
      console.log(
        `[handleSocialMediaPost] Signed URL created with ${expiresIn}s expiry for non-TikTok platforms`
      );
    }

    // Process each platform in parallel for maximum performance
    const [
      tiktokAccountResults,
      pinterestAccountResults,
      linkedinAccountResults,
      instagramAccountResults,
    ] = await Promise.all([
      // Process TikTok accounts (if any and not image posts)
      tiktokAccounts.length > 0
        ? fetch(`${process.env.FRONTEND_URL}/api/social/process/tiktok`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accounts: tiktokAccounts,
              mediaPath,
              mediaType,
              fileName: fileName ?? "",
              platformOptions,
              accountContent,
              isScheduled,
              tiktokMediaUrl,
              scheduledDate: scheduledDate ?? "",
              scheduledTime: scheduledTime ?? "",
              postType,
              coverTimestamp,
              userId,
              batchId,
              cronSecret,
            }),
          }).then((res) => res.json())
        : Promise.resolve({ successCount: 0, errors: [] }),

      // Process Pinterest accounts (if any and not text posts)
      pinterestAccounts.length > 0 && postType !== "text"
        ? fetch(`${process.env.FRONTEND_URL}/api/social/process/pinterest`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accounts: pinterestAccounts,
              mediaPath,
              coverTimestamp,
              mediaType,
              fileName: fileName ?? "",
              boards: boards || [],
              platformOptions,
              accountContent,
              isScheduled,
              scheduledDate: scheduledDate ?? "",
              scheduledTime: scheduledTime ?? "",
              postType,
              userId,
              batchId,
              cronSecret,
            }),
          }).then((res) => res.json())
        : Promise.resolve({ successCount: 0, errors: [] }),

      // Process LinkedIn accounts (if any)
      linkedinAccounts.length > 0
        ? fetch(`${process.env.FRONTEND_URL}/api/social/process/linkedin`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accounts: linkedinAccounts,
              mediaPath,
              coverTimestamp,
              fileName: fileName ?? "",
              platformOptions,
              accountContent,
              isScheduled,
              scheduledDate: scheduledDate ?? "",
              scheduledTime: scheduledTime ?? "",
              postType,
              userId,
              batchId,
              mediaType,
              cronSecret,
            }),
          }).then((res) => res.json())
        : Promise.resolve({ successCount: 0, errors: [] }),
      instagramAccounts.length > 0 && postType !== "text"
        ? fetch(`${process.env.FRONTEND_URL}/api/social/process/instagram`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accounts: instagramAccounts,
              mediaPath,
              coverTimestamp,
              mediaType,
              mediaUrl,
              fileName: fileName ?? "",
              accountContent,
              isScheduled,
              scheduledDate: scheduledDate ?? "",
              scheduledTime: scheduledTime ?? "",
              postType,
              userId,
              batchId,
              cronSecret,
            }),
          }).then((res) => res.json())
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
      ...instagramAccountResults.errors,
    ];

    // Collect success counts
    results.counts.pinterest = pinterestAccountResults.successCount;
    results.counts.linkedin = linkedinAccountResults.successCount;
    results.counts.tiktok = tiktokAccountResults.successCount;
    results.counts.instagram = instagramAccountResults.successCount;

    results.counts.total =
      results.counts.pinterest +
      results.counts.linkedin +
      results.counts.tiktok +
      results.counts.instagram;

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
    const shouldCleanup = !isScheduled && cleanupFiles && mediaPath;

    if (shouldCleanup) {
      const hasExternalDownloads =
        tiktokAccounts.length > 0 || instagramAccounts.length > 0;

      if (hasExternalDownloads) {
        console.log(
          `[Cleanup] Waiting 30s for external downloads to complete...`
        );
        await new Promise((resolve) => setTimeout(resolve, 30 * 1000));
      }

      try {
        await deleteSupabaseFileAction(userId, mediaPath, false, cronSecret);
        console.log(
          `[handleSocialMediaPost]: Cleaned up temporary media file: ${mediaPath}`
        );
      } catch (cleanupError) {
        console.error(
          `[handleSocialMediaPost]: Error cleaning up media file:`,
          cleanupError
        );
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
    const shouldCleanupOnError = !isScheduled && cleanupFiles && mediaPath;

    if (shouldCleanupOnError) {
      try {
        await deleteSupabaseFileAction(userId, mediaPath, true, cronSecret);
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
  if (counts.instagram > 0) {
    platforms.push(`${counts.instagram} on Instagram`);
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

function validateAccountContent(
  accounts: SocialAccount[],
  accountContent: ContentInfo[],
  platform: string,
  boards?: BoardInfo[],
  postType?: string
): AccountError[] {
  const errors: AccountError[] = [];

  accounts.forEach((account) => {
    const content = accountContent.find((c) => c.accountId === account.id);
    const displayName = account.display_name ?? account.username ?? account.id;

    if (!content) {
      errors.push({
        accountId: account.id,
        platform,
        displayName,
        error: "No content configured for this account",
      });
      return;
    }

    // Platform-specific validations
    if (platform === "pinterest" && postType !== "text") {
      const hasSelectedBoard = boards?.some(
        (b) => b.accountId === account.id && b.isSelected
      );
      if (!hasSelectedBoard) {
        errors.push({
          accountId: account.id,
          platform,
          displayName,
          error: "No board selected for this account",
        });
      }
    }

    if (platform === "linkedin" && !account.account_identifier) {
      errors.push({
        accountId: account.id,
        platform,
        displayName,
        error: "No LinkedIn identifier found for this account",
      });
    }
  });

  return errors;
}
