// src/actions/server/handleSocialMediaPost/handleSocialMediaPost.ts
"use server";

import { authCheck } from "@/actions/server/authCheck";
import { authCheckCronJob } from "@/actions/server/authCheckCronJob";
import { deleteSupabaseFileAction } from "@/actions/server/data/storageFiles/deleteSupabaseFileAction";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { schedulePostBatch } from "@/actions/server/scheduleActions/schedule/schedulePostBatch";
import { MediaType } from "@/lib/types/database.types";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import type { SchedulePostData } from "@/lib/types/SchedulePostData";
import { getMimeTypeFromFileName } from "../../../lib/utils/getMimeTypeFromFileName";
import {
  directPostBatch,
  DirectPostData,
} from "../directPostActions/directPostBatch";
import { generateSuccessMessage } from "./successMessage";
import { validateAccountContent } from "./validateContent";

// ────────────────────────────────────────────────────────────
// Shared types
// ────────────────────────────────────────────────────────────

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
  batch_id?: string;
  event_ids?: string[];
};

const ZERO_COUNTS: PlatformCounts = {
  pinterest: 0,
  linkedin: 0,
  tiktok: 0,
  instagram: 0,
  total: 0,
};

/**
 * Orchestrates direct and scheduled posting across all platforms.
 *
 * Direct path (isScheduled=false): dispatches Inngest `post.now` events,
 * one per account × platform pair. processDirectPost worker handles
 * each, then writes content_history and cleans up media.
 *
 * Scheduled path (isScheduled=true): builds a SchedulePostData[] array
 * and calls schedulePostBatch (shared core for web/MCP/x402). One bulk
 * upsert into scheduled_posts. The processSinglePost worker fires later
 * when scheduled_at is reached.
 *
 * Tables touched:
 *   - scheduled_posts (insert, scheduled path)
 *   - pending_direct_posts (insert, direct path)
 *   - social_accounts (read, ownership checked in core)
 *   - platform_quotas (read, daily cap in core)
 *
 * Rate limits:
 *   - Outer (this fn): 30 calls per 60s per user, covers both paths.
 *   - Inner (schedulePostBatch): 10 calls per 60s per user, scheduled only.
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
  postType: MediaType;
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

  // Step 1: account count guard
  const totalAccounts =
    pinterestAccounts.length +
    linkedinAccounts.length +
    instagramAccounts.length +
    tiktokAccounts.length;

  if (totalAccounts === 0) {
    console.error("[handleSocialMediaPost] No accounts provided");
    return {
      success: false,
      counts: ZERO_COUNTS,
      message:
        "No accounts selected for posting. Please select at least one account.",
      errors: [],
    };
  }

  console.log(
    `[handleSocialMediaPost] Starting ${isScheduled ? "scheduled" : "direct"} post for ${totalAccounts} accounts`,
  );

  // Step 2: auth
  const authResult = cronSecret
    ? await authCheckCronJob(userId, cronSecret)
    : await authCheck(userId);

  if (!authResult) {
    const errorMessage = cronSecret
      ? "Cron job authentication failed. Invalid secret key."
      : "Authentication validation failed. Please sign in again.";
    console.error(`[handleSocialMediaPost] Auth failed for user: ${userId}`);
    return {
      success: false,
      counts: ZERO_COUNTS,
      message: errorMessage,
      errors: [],
    };
  }

  // Step 3: outer rate limit (covers both direct + scheduled flows)
  const rateCheck = await checkRateLimit(
    "handleSocialMediaPost",
    userId,
    30,
    60,
    cronSecret,
  );
  if (!rateCheck.success) {
    console.warn(`[handleSocialMediaPost] Rate limit exceeded for ${userId}`);
    return {
      success: false,
      counts: ZERO_COUNTS,
      message: "Too many requests. Please try again later.",
      resetIn: rateCheck.resetIn,
      errors: [],
    };
  }

  // Step 4: media presence validation
  const requiresMedia =
    (postType === "image" || postType === "video") &&
    (pinterestAccounts.length > 0 ||
      (tiktokAccounts.length > 0 && postType === "video"));

  if (!mediaPath && requiresMedia) {
    console.error(
      `[handleSocialMediaPost] Media required for ${postType} posts`,
    );
    return {
      success: false,
      counts: ZERO_COUNTS,
      message: `${postType} posts require media files for Pinterest${
        postType === "video" ? " and TikTok" : ""
      }`,
      errors: [],
    };
  }

  // Step 5: mime type derivation (used by direct path only)
  let mediaType = "";
  if (mediaPath && fileName) {
    const mimeResult = getMimeTypeFromFileName(fileName);
    if (!mimeResult.success) {
      console.error(
        `[handleSocialMediaPost] Mime detection failed: ${mimeResult.message}`,
      );
      if (cleanupFiles) {
        await deleteSupabaseFileAction(
          userId,
          mediaPath,
          true,
          cronSecret,
        ).catch((cleanupErr: unknown) =>
          console.error("[handleSocialMediaPost] Cleanup failed:", cleanupErr),
        );
      }
      return {
        success: false,
        counts: ZERO_COUNTS,
        message: mimeResult.message || "Failed to process media file.",
        errors: [],
      };
    }
    mediaType = mimeResult.mimeType;
  }

  // Step 6: content validation (Pinterest board, LinkedIn identifier, etc.)
  const missingContentAccounts: AccountError[] = [
    ...validateAccountContent(
      pinterestAccounts,
      accountContent,
      "pinterest",
      boards,
      postType,
    ),
    ...validateAccountContent(linkedinAccounts, accountContent, "linkedin"),
    ...validateAccountContent(tiktokAccounts, accountContent, "tiktok"),
    ...validateAccountContent(instagramAccounts, accountContent, "instagram"),
  ];

  if (missingContentAccounts.length > 0) {
    console.error(
      `[handleSocialMediaPost] ${missingContentAccounts.length} accounts have invalid configuration`,
    );
    return {
      success: false,
      counts: ZERO_COUNTS,
      message:
        "Some accounts have invalid configuration. Please check your settings.",
      errors: missingContentAccounts,
    };
  }

  // Step 7: branch on direct vs scheduled
  if (!isScheduled) {
    return directPostFromForm({
      pinterestAccounts,
      linkedinAccounts,
      tiktokAccounts,
      instagramAccounts,
      mediaPath,
      coverTimestamp,
      boards,
      platformOptions,
      accountContent,
      postType,
      userId: userId!,
      batchId,
    });
  }

  // Scheduled path: 1× bulk upsert via shared core.
  return scheduleAllPosts({
    pinterestAccounts,
    linkedinAccounts,
    tiktokAccounts,
    instagramAccounts,
    mediaPath,
    coverTimestamp,
    boards,
    platformOptions,
    accountContent,
    scheduledDate: scheduledDate ?? "",
    scheduledTime: scheduledTime ?? "",
    postType,
    userId: userId!,
    batchId,
  });
}

// ────────────────────────────────────────────────────────────
// Scheduled-post bulk dispatch (NEW: replaces 4× internal fetch)
// ────────────────────────────────────────────────────────────

/**
 * Builds a SchedulePostData[] from the 4 platform account arrays and
 * delegates to schedulePostBatch for a single bulk upsert into
 * scheduled_posts. Translates the core result back to the legacy
 * PostResult shape consumed by SocialPostForm.
 *
 * Per-platform postOptions shape (FLAT, matches worker's read pattern in
 * callPlatformDirectPost / callDirectPostFromEvent):
 *   Pinterest: { privacyLevel, board_id, boardName, link }
 *   LinkedIn:  { memberUrn, link, visibility }
 *   TikTok:    spread of platformOptions.tiktok
 *   Instagram: null
 *
 * Skips Pinterest/Instagram for text posts (legacy behavior). TikTok
 * text is built and rejected later by the worker's compatibility check.
 */
async function scheduleAllPosts(args: {
  pinterestAccounts: SocialAccount[];
  linkedinAccounts: SocialAccount[];
  tiktokAccounts: SocialAccount[];
  instagramAccounts: SocialAccount[];
  mediaPath: string;
  coverTimestamp: number;
  boards?: BoardInfo[];
  platformOptions: PlatformOptions;
  accountContent: ContentInfo[];
  scheduledDate: string;
  scheduledTime: string;
  postType: MediaType;
  userId: string;
  batchId: string;
}): Promise<PostResult> {
  const scheduledAtIso = new Date(
    `${args.scheduledDate}T${args.scheduledTime}`,
  ).toISOString();

  // Build accounts lookup once for displayName resolution on errors.
  const accountsLookup = new Map<string, SocialAccount>();
  for (const account of [
    ...args.pinterestAccounts,
    ...args.linkedinAccounts,
    ...args.tiktokAccounts,
    ...args.instagramAccounts,
  ]) {
    accountsLookup.set(account.id, account);
  }

  const findContent = (accountId: string): ContentInfo | undefined =>
    args.accountContent.find((c) => c.accountId === accountId);

  const posts: SchedulePostData[] = [];

  // Pinterest (skipped for text, matches legacy)
  if (args.postType !== "text") {
    for (const account of args.pinterestAccounts) {
      const content = findContent(account.id);
      if (!content) continue;
      const selectedBoard = args.boards?.find(
        (b) => b.accountId === account.id && b.isSelected,
      );
      posts.push({
        socialAccountId: account.id,
        platform: "pinterest",
        scheduledAt: scheduledAtIso,
        title: content.title,
        description: content.description,
        postType: args.postType,
        mediaStoragePath: args.mediaPath,
        coverTimestamp: args.coverTimestamp,
        batch_id: args.batchId,
        postOptions: {
          privacyLevel:
            args.platformOptions.pinterest?.privacyLevel ?? "PUBLIC",
          board: selectedBoard?.boardID ?? "",
          boardName: selectedBoard?.boardName ?? "",
          link: content.link,
        },
      });
    }
  }

  // LinkedIn (always built; LinkedIn supports text)
  for (const account of args.linkedinAccounts) {
    const content = findContent(account.id);
    if (!content) continue;
    posts.push({
      socialAccountId: account.id,
      platform: "linkedin",
      scheduledAt: scheduledAtIso,
      title: "",
      description: content.description,
      postType: args.postType,
      mediaStoragePath: args.mediaPath,
      coverTimestamp: args.coverTimestamp,
      batch_id: args.batchId,
      postOptions: {
        memberUrn: `urn:li:person:${account.account_identifier}`,
        link: content.link || undefined,
        visibility: args.platformOptions.linkedin?.visibility ?? "PUBLIC",
      },
    });
  }

  // TikTok (built for all postType, worker rejects text)
  for (const account of args.tiktokAccounts) {
    const content = findContent(account.id);
    if (!content) continue;
    posts.push({
      socialAccountId: account.id,
      platform: "tiktok",
      scheduledAt: scheduledAtIso,
      title: "",
      description: content.description,
      postType: args.postType,
      mediaStoragePath: args.mediaPath,
      coverTimestamp: args.coverTimestamp,
      batch_id: args.batchId,
      postOptions: args.platformOptions.tiktok ?? null,
    });
  }

  // Instagram (skipped for text, matches legacy)
  if (args.postType !== "text") {
    for (const account of args.instagramAccounts) {
      const content = findContent(account.id);
      if (!content) continue;
      posts.push({
        socialAccountId: account.id,
        platform: "instagram",
        scheduledAt: scheduledAtIso,
        title: "",
        description: content.description,
        postType: args.postType,
        mediaStoragePath: args.mediaPath,
        coverTimestamp: args.coverTimestamp,
        batch_id: args.batchId,
        postOptions: null,
      });
    }
  }

  if (posts.length === 0) {
    return {
      success: false,
      counts: ZERO_COUNTS,
      message:
        "No posts to schedule after filtering. Check post type vs platform compatibility.",
      errors: [],
    };
  }

  // Step: bulk upsert via shared core
  const scheduleResult = await schedulePostBatch(posts, args.userId, "web");

  // Translate core result -> legacy PostResult shape
  const rejectedAccountIds = new Set(
    scheduleResult.details.rejected.map((r) => r.socialAccountId),
  );

  const counts: PlatformCounts = { ...ZERO_COUNTS };
  if (scheduleResult.success) {
    for (const post of posts) {
      if (rejectedAccountIds.has(post.socialAccountId)) continue;
      const platformKey = post.platform as keyof PlatformCounts;
      if (
        platformKey === "pinterest" ||
        platformKey === "linkedin" ||
        platformKey === "tiktok" ||
        platformKey === "instagram"
      ) {
        counts[platformKey]++;
      }
    }
    counts.total =
      counts.pinterest + counts.linkedin + counts.tiktok + counts.instagram;
  }

  const errors: AccountError[] = scheduleResult.details.rejected.map(
    (rejection) => {
      const account = accountsLookup.get(rejection.socialAccountId);
      const displayName =
        account?.display_name ??
        account?.username ??
        account?.id ??
        rejection.socialAccountId;
      return {
        accountId: rejection.socialAccountId,
        platform: account?.platform ?? "unknown",
        displayName,
        error: rejection.reason,
      };
    },
  );

  const message =
    scheduleResult.success && counts.total > 0
      ? generateSuccessMessage(counts, true, errors.length)
      : scheduleResult.message;

  return {
    success: scheduleResult.success && counts.total > 0,
    counts,
    message,
    errors,
    resetIn: scheduleResult.resetIn,
    batch_id: scheduleResult.batchId,
  };
}

// ────────────────────────────────────────────────────────────
// Direct-post Inngest event dispatch (UNCHANGED from before)
// ────────────────────────────────────────────────────────────

async function directPostFromForm(args: {
  pinterestAccounts: SocialAccount[];
  linkedinAccounts: SocialAccount[];
  tiktokAccounts: SocialAccount[];
  instagramAccounts: SocialAccount[];
  mediaPath: string;
  coverTimestamp: number;
  boards?: BoardInfo[];
  platformOptions: PlatformOptions;
  accountContent: ContentInfo[];
  postType: MediaType;
  userId: string;
  batchId: string;
}): Promise<PostResult> {
  const findContent = (accountId: string) =>
    args.accountContent.find((c) => c.accountId === accountId);

  const posts: DirectPostData[] = [];

  for (const account of args.linkedinAccounts) {
    const content = findContent(account.id);
    if (!content) continue;
    posts.push({
      socialAccountId: account.id,
      platform: "linkedin",
      postType: args.postType,
      title: content.title,
      description: content.description,
      mediaStoragePath: args.mediaPath,
      coverTimestamp: args.coverTimestamp,
      platformOptions: args.platformOptions,
    });
  }

  for (const account of args.pinterestAccounts) {
    const content = findContent(account.id);
    if (!content) continue;
    const selectedBoard = args.boards?.find(
      (b) => b.accountId === account.id && b.isSelected,
    );
    posts.push({
      socialAccountId: account.id,
      platform: "pinterest",
      postType: args.postType,
      title: content.title,
      description: content.description,
      mediaStoragePath: args.mediaPath,
      coverTimestamp: args.coverTimestamp,
      platformOptions: args.platformOptions,
      pinterestBoardId: selectedBoard?.boardID,
      pinterestBoardName: selectedBoard?.boardName,
      pinterestLink: content.link || undefined,
    });
  }

  for (const account of args.tiktokAccounts) {
    const content = findContent(account.id);
    if (!content) continue;
    posts.push({
      socialAccountId: account.id,
      platform: "tiktok",
      postType: args.postType,
      title: content.title,
      description: content.description,
      mediaStoragePath: args.mediaPath,
      coverTimestamp: args.coverTimestamp,
      platformOptions: args.platformOptions,
    });
  }

  for (const account of args.instagramAccounts) {
    const content = findContent(account.id);
    if (!content) continue;
    posts.push({
      socialAccountId: account.id,
      platform: "instagram",
      postType: args.postType,
      title: content.title,
      description: content.description,
      mediaStoragePath: args.mediaPath,
      coverTimestamp: args.coverTimestamp,
      platformOptions: args.platformOptions,
    });
  }

  if (posts.length === 0) {
    return {
      success: false,
      counts: ZERO_COUNTS,
      message: "No posts to dispatch.",
      errors: [],
    };
  }

  const result = await directPostBatch(posts, args.userId, "web", args.batchId);

  const counts: PlatformCounts = { ...ZERO_COUNTS };
  const rejectedIds = new Set(
    result.details.rejected.map((r) => r.socialAccountId),
  );
  for (const post of posts) {
    if (rejectedIds.has(post.socialAccountId)) continue;
    counts[post.platform as keyof PlatformCounts]++;
  }
  counts.total =
    counts.pinterest + counts.linkedin + counts.tiktok + counts.instagram;

  const accountsLookup = new Map<string, SocialAccount>();
  for (const acc of [
    ...args.pinterestAccounts,
    ...args.linkedinAccounts,
    ...args.tiktokAccounts,
    ...args.instagramAccounts,
  ]) {
    accountsLookup.set(acc.id, acc);
  }

  const errors: AccountError[] = result.details.rejected.map((r) => {
    const acc = accountsLookup.get(r.socialAccountId);
    return {
      accountId: r.socialAccountId,
      platform: acc?.platform ?? "unknown",
      displayName:
        acc?.display_name ?? acc?.username ?? acc?.id ?? r.socialAccountId,
      error: r.reason,
    };
  });

  return {
    success: result.success && counts.total > 0,
    counts,
    message: result.message,
    errors,
    resetIn: result.resetIn,
    batch_id: result.batchId,
    event_ids: result.eventIds,
  };
}
