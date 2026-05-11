"use server";

import { getServerSignedViewUrl } from "@/actions/server/data/getServerSignedViewUrl";
import { authCheck } from "@/actions/server/authCheck";
import { authCheckCronJob } from "@/actions/server/authCheckCronJob";
import { deleteSupabaseFileAction } from "@/actions/server/data/deleteSupabaseFileAction";
import { buildProxiedTikTokMediaUrl } from "@/lib/api/tiktok/buildProxiedTikTokMediaUrl";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { getMimeTypeFromFileName } from "../getMimeTypeFromFileName";
import { generateSuccessMessage } from "./successMessage";
import { validateAccountContent } from "./validateContent";
import { randomUUID } from "crypto";
import type { PostNowEventData } from "@/inngest/functions/processDirectPostHelpers";
import { dispatchPostNowEvents } from "@/inngest/dispatch/dispatchPostNowEvents";

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

export type PlatformCounts = {
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
  errors?: AccountError[];
  resetIn?: number;
  // FIX 26: for direct posts through Inngest
  batch_id?: string;
  event_ids?: string[];
};

/**
 * Unified function to handle both direct posting and scheduling across different platforms.
 * Direct posts (isScheduled=false) are dispatched through Inngest workers.
 * Scheduled posts (isScheduled=true) flow through the existing /api/social routes.
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
  cronSecret?: string;
}): Promise<PostResult> {
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

  const zeroCounts: PlatformCounts = {
    pinterest: 0,
    linkedin: 0,
    tiktok: 0,
    instagram: 0,
    total: 0,
  };

  // Step 1: Check if there are any accounts to process
  const totalAccounts =
    pinterestAccounts.length +
    linkedinAccounts.length +
    instagramAccounts.length +
    tiktokAccounts.length;

  if (totalAccounts === 0) {
    console.error(
      "[handleSocialMediaPost] No accounts provided for processing"
    );
    return {
      success: false,
      counts: zeroCounts,
      message:
        "No accounts selected for posting. Please select at least one account.",
      errors: [],
    };
  }

  console.log(
    `[handleSocialMediaPost] Starting ${
      isScheduled ? "scheduled" : "direct"
    } post for ${totalAccounts} accounts`
  );

  // Step 2: Verify authentication
  const authResult = cronSecret
    ? await authCheckCronJob(userId, cronSecret)
    : await authCheck(userId);

  if (!authResult) {
    const errorMessage = cronSecret
      ? "Cron job authentication failed. Invalid secret key."
      : "Authentication validation failed. Please sign in again.";
    console.error(
      `[handleSocialMediaPost] Authentication failed for user: ${userId}`
    );
    return { success: false, counts: zeroCounts, message: errorMessage, errors: [] };
  }

  // Step 3: Rate limit
  const rateCheck = await checkRateLimit(
    "handleSocialMediaPost",
    userId,
    30,
    60,
    cronSecret
  );
  if (!rateCheck.success) {
    console.warn(
      `[handleSocialMediaPost] Rate limit exceeded for user: ${userId}`
    );
    return {
      success: false,
      counts: zeroCounts,
      message: "Too many requests. Please try again later.",
      resetIn: rateCheck.resetIn,
      errors: [],
    };
  }

  // Step 4: Media validation
  const requiresMedia =
    (postType === "image" || postType === "video") &&
    (pinterestAccounts.length > 0 ||
      (tiktokAccounts.length > 0 && postType === "video"));

  if (!mediaPath && requiresMedia) {
    console.error(
      `[handleSocialMediaPost] Media required for ${postType} posts`
    );
    return {
      success: false,
      counts: zeroCounts,
      message: `${postType} posts require media files for Pinterest${
        postType === "video" ? " and TikTok" : ""
      }`,
      errors: [],
    };
  }

  let mediaType = "";
  if (mediaPath && fileName) {
    const mimeResult = getMimeTypeFromFileName(fileName);
    if (!mimeResult.success) {
      console.error(
        `[handleSocialMediaPost] Error processing file: ${mimeResult.message}`
      );
      if (cleanupFiles) {
        await deleteSupabaseFileAction(userId, mediaPath, true, cronSecret).catch(
          (e: unknown) =>
            console.error("[handleSocialMediaPost] Cleanup failed:", e)
        );
      }
      return {
        success: false,
        counts: zeroCounts,
        message: mimeResult.message || "Failed to process media file.",
        errors: [],
      };
    }
    mediaType = mimeResult.mimeType;
  }

  // Step 5: Content validation
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
      `[handleSocialMediaPost] ${missingContentAccounts.length} accounts have invalid configuration`
    );
    return {
      success: false,
      counts: zeroCounts,
      message:
        "Some accounts have invalid configuration. Please check your settings.",
      errors: missingContentAccounts,
    };
  }

  // Step 6: Mint URLs (only for direct posts)
  let mediaUrl: string | undefined;
  let tiktokMediaUrl: string | undefined;

  if (!isScheduled && tiktokAccounts.length > 0 && mediaPath) {
    const tiktokUrlResult = buildProxiedTikTokMediaUrl({
      mediaPath,
      principalId: userId!,
    });
    if (!tiktokUrlResult.success) {
      return {
        success: false,
        counts: zeroCounts,
        message: tiktokUrlResult.message,
        errors: [],
      };
    }
    tiktokMediaUrl = tiktokUrlResult.url;
    console.log(
      `[handleSocialMediaPost] TikTok proxy URL created for ${tiktokAccounts.length} accounts`
    );
  }

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
    const signedUrlResult = await getServerSignedViewUrl(mediaPath);
    if (!signedUrlResult.success) {
      console.error(
        `[handleSocialMediaPost] Failed to create signed URL: ${signedUrlResult.message}`
      );
      return {
        success: false,
        counts: zeroCounts,
        message: signedUrlResult.message,
        errors: [],
      };
    }
    mediaUrl = signedUrlResult.url;
    console.log(
      "[handleSocialMediaPost] Signed URL created for non-TikTok platforms"
    );
  }

  // ────────────────────────────────────────────────────────
  // DIRECT POST PATH (FIX 26): dispatch through Inngest
  // ────────────────────────────────────────────────────────
  if (!isScheduled) {
    return dispatchDirectPostEvents({
      pinterestAccounts,
      linkedinAccounts,
      tiktokAccounts,
      instagramAccounts,
      mediaPath,
      coverTimestamp,
      fileName: fileName ?? "",
      boards,
      platformOptions,
      accountContent,
      postType,
      userId: userId!,
      batchId,
      mediaType,
      mediaUrl: mediaUrl ?? null,
      tiktokMediaUrl: tiktokMediaUrl ?? null,
    });
  }

  // ────────────────────────────────────────────────────────
  // SCHEDULED POST PATH: existing behavior (unchanged)
  // ────────────────────────────────────────────────────────
  const routeSecret = process.env.CRON_SECRET_KEY;
  const startTime = performance.now();

  const [
    tiktokAccountResults,
    pinterestAccountResults,
    linkedinAccountResults,
    instagramAccountResults,
  ] = await Promise.all([
    tiktokAccounts.length > 0
      ? fetch(`${process.env.FRONTEND_URL}/api/social/tiktok/process`, {
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
            cronSecret: routeSecret,
          }),
        }).then((res) => res.json())
      : Promise.resolve({ successCount: 0, errors: [] }),

    pinterestAccounts.length > 0 && postType !== "text"
      ? fetch(`${process.env.FRONTEND_URL}/api/social/pinterest/process`, {
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
            cronSecret: routeSecret,
            mediaUrl,
          }),
        }).then((res) => res.json())
      : Promise.resolve({ successCount: 0, errors: [] }),

    linkedinAccounts.length > 0
      ? fetch(`${process.env.FRONTEND_URL}/api/social/linkedin/process`, {
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
            cronSecret: routeSecret,
          }),
        }).then((res) => res.json())
      : Promise.resolve({ successCount: 0, errors: [] }),

    instagramAccounts.length > 0 && postType !== "text"
      ? fetch(`${process.env.FRONTEND_URL}/api/social/instagram/process`, {
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
            cronSecret: routeSecret,
          }),
        }).then((res) => res.json())
      : Promise.resolve({ successCount: 0, errors: [] }),
  ]);

  const processingTime = performance.now() - startTime;
  console.log(
    `[handleSocialMediaPost] Scheduled processing completed in ${processingTime.toFixed(2)}ms`
  );

  const errors: AccountError[] = [
    ...tiktokAccountResults.errors,
    ...pinterestAccountResults.errors,
    ...linkedinAccountResults.errors,
    ...instagramAccountResults.errors,
  ];

  const counts: PlatformCounts = {
    pinterest: pinterestAccountResults.successCount,
    linkedin: linkedinAccountResults.successCount,
    tiktok: tiktokAccountResults.successCount,
    instagram: instagramAccountResults.successCount,
    total: 0,
  };
  counts.total =
    counts.pinterest + counts.linkedin + counts.tiktok + counts.instagram;

  if (errors.length > 0) {
    console.log(
      `[handleSocialMediaPost] ${errors.length} account-level errors occurred`
    );
  }

  const success = counts.total > 0;
  const message = generateSuccessMessage(counts, isScheduled, errors.length);

  return {
    success,
    counts,
    message: counts.total === 0 && !message
      ? "No posts were processed successfully."
      : message,
    errors,
  };
}

// ────────────────────────────────────────────────────────
// Direct-post Inngest event dispatch (FIX 26)
// ────────────────────────────────────────────────────────

async function dispatchDirectPostEvents(args: {
  pinterestAccounts: SocialAccount[];
  linkedinAccounts: SocialAccount[];
  tiktokAccounts: SocialAccount[];
  instagramAccounts: SocialAccount[];
  mediaPath: string;
  coverTimestamp: number;
  fileName: string;
  boards?: BoardInfo[];
  platformOptions: PlatformOptions;
  accountContent: ContentInfo[];
  postType: "image" | "video" | "text";
  userId: string;
  batchId: string;
  mediaType: string;
  mediaUrl: string | null;
  tiktokMediaUrl: string | null;
}): Promise<PostResult> {
  const zeroCounts: PlatformCounts = {
    pinterest: 0,
    linkedin: 0,
    tiktok: 0,
    instagram: 0,
    total: 0,
  };

  const events: { name: "post.now"; data: PostNowEventData }[] = [];

  const findContent = (accountId: string) =>
    args.accountContent.find((c) => c.accountId === accountId);

  // Build events for each platform x account pair
  for (const account of args.linkedinAccounts) {
    const content = findContent(account.id);
    if (!content) continue;
    events.push({
      name: "post.now",
      data: {
        batch_id: args.batchId,
        principal_id: args.userId,
        social_account_id: account.id,
        platform: "linkedin",
        post_type: args.postType,
        account_content: content,
        platform_options: args.platformOptions,
        board: null,
        cover_timestamp: args.coverTimestamp,
        file_name: args.fileName,
        media_type: args.mediaType,
        media_path: args.mediaPath,
        media_url: args.mediaUrl,
        tiktok_media_url: null,
      },
    });
  }

  for (const account of args.pinterestAccounts) {
    const content = findContent(account.id);
    if (!content) continue;
    const selectedBoard = args.boards?.find(
      (b) => b.accountId === account.id && b.isSelected
    );
    events.push({
      name: "post.now",
      data: {
        batch_id: args.batchId,
        principal_id: args.userId,
        social_account_id: account.id,
        platform: "pinterest",
        post_type: args.postType,
        account_content: content,
        platform_options: args.platformOptions,
        board: selectedBoard ?? null,
        cover_timestamp: args.coverTimestamp,
        file_name: args.fileName,
        media_type: args.mediaType,
        media_path: args.mediaPath,
        media_url: args.mediaUrl,
        tiktok_media_url: null,
      },
    });
  }

  for (const account of args.tiktokAccounts) {
    const content = findContent(account.id);
    if (!content) continue;
    events.push({
      name: "post.now",
      data: {
        batch_id: args.batchId,
        principal_id: args.userId,
        social_account_id: account.id,
        platform: "tiktok",
        post_type: args.postType,
        account_content: content,
        platform_options: args.platformOptions,
        board: null,
        cover_timestamp: args.coverTimestamp,
        file_name: args.fileName,
        media_type: args.mediaType,
        media_path: args.mediaPath,
        media_url: null,
        tiktok_media_url: args.tiktokMediaUrl,
      },
    });
  }

  for (const account of args.instagramAccounts) {
    const content = findContent(account.id);
    if (!content) continue;
    events.push({
      name: "post.now",
      data: {
        batch_id: args.batchId,
        principal_id: args.userId,
        social_account_id: account.id,
        platform: "instagram",
        post_type: args.postType,
        account_content: content,
        platform_options: args.platformOptions,
        board: null,
        cover_timestamp: args.coverTimestamp,
        file_name: args.fileName,
        media_type: args.mediaType,
        media_path: args.mediaPath,
        media_url: args.mediaUrl,
        tiktok_media_url: null,
      },
    });
  }

  if (events.length === 0) {
    console.error("[handleSocialMediaPost] No events to dispatch");
    return {
      success: false,
      counts: zeroCounts,
      message: "No accounts to post to.",
      errors: [],
    };
  }

  // Generate dispatch IDs and INSERT lock rows BEFORE dispatching.
  const eventsWithDispatch = events.map((evt) => ({
    ...evt,
    data: {
      ...evt.data,
      dispatch_id: randomUUID(),
      created_via: "web" as const,
    },
  }));

  const dispatch = await dispatchPostNowEvents(eventsWithDispatch);
  if (!dispatch.success) {
    console.error(
      `[handleSocialMediaPost] Dispatch failed (${dispatch.phase}):`,
      dispatch.message
    );
    const userMessage =
      dispatch.phase === "lock_insert"
        ? "Could not initialize post dispatch. Please try again in a moment."
        : "Failed to start posting. Please try again.";
    return {
      success: false,
      counts: zeroCounts,
      message: userMessage,
      errors: [],
    };
  }

  const counts: PlatformCounts = {
    linkedin: args.linkedinAccounts.length,
    pinterest: args.pinterestAccounts.length,
    tiktok: args.tiktokAccounts.length,
    instagram: args.instagramAccounts.length,
    total: eventsWithDispatch.length,
  };

  return {
    success: true,
    counts,
    message: `Posting to ${eventsWithDispatch.length} account${eventsWithDispatch.length > 1 ? "s" : ""}`,
    batch_id: args.batchId,
    event_ids: dispatch.eventIds,
  };
}
