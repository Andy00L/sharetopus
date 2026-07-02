// src/actions/server/handleSocialMediaPost/handleSocialMediaPost.ts
"use server";

import { authCheck } from "@/actions/server/authCheck";
import { authCheckCronJob } from "@/actions/server/authCheckCronJob";
import { deleteSupabaseFileAction } from "@/actions/server/data/storageFiles/deleteSupabaseFileAction";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { schedulePostBatch } from "@/actions/server/scheduleActions/schedule/schedulePostBatch";
import {
  POSTING_PLATFORMS,
  isPostingPlatform,
  platformSupportsMediaType,
  type PostingPlatform,
} from "@/lib/platforms/capabilities";
import { MediaType } from "@/lib/types/database.types";
import { generateRequestId } from "@/lib/utils/generateRequestId";
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

export type PlatformCounts = Record<PostingPlatform, number> & {
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

function buildZeroCounts(): PlatformCounts {
  const counts = { total: 0 } as PlatformCounts;
  for (const platform of POSTING_PLATFORMS) {
    counts[platform] = 0;
  }
  return counts;
}

// ────────────────────────────────────────────────────────────
// Per-platform form adapters
// ────────────────────────────────────────────────────────────

type ScheduleOptionsBuilderArgs = {
  account: SocialAccount;
  content: ContentInfo;
  platformOptions: PlatformOptions;
  selectedBoard: BoardInfo | undefined;
};

type PlatformFormAdapter = {
  /** Whether scheduled_posts.post_title should carry the form title. */
  keepsTitle: boolean;
  /** post_options payload the worker reads back (flat, per platform). */
  buildScheduleOptions: (
    args: ScheduleOptionsBuilderArgs,
  ) => SchedulePostData["postOptions"];
};

/**
 * The only per-platform knowledge the web form path needs. Everything
 * else (validation, quota, dispatch) is platform-agnostic in the batch
 * cores and the Inngest workers.
 */
const PLATFORM_FORM_ADAPTERS: Record<PostingPlatform, PlatformFormAdapter> = {
  pinterest: {
    keepsTitle: true,
    buildScheduleOptions: ({ content, platformOptions, selectedBoard }) => ({
      privacyLevel: platformOptions.pinterest?.privacyLevel ?? "PUBLIC",
      board: selectedBoard?.boardID ?? "",
      boardName: selectedBoard?.boardName ?? "",
      link: content.link,
    }),
  },
  linkedin: {
    keepsTitle: false,
    buildScheduleOptions: ({ account, content, platformOptions }) => ({
      memberUrn: `urn:li:person:${account.account_identifier}`,
      link: content.link || undefined,
      visibility: platformOptions.linkedin?.visibility ?? "PUBLIC",
    }),
  },
  tiktok: {
    keepsTitle: false,
    buildScheduleOptions: ({ platformOptions }) =>
      platformOptions.tiktok ?? null,
  },
  instagram: {
    keepsTitle: false,
    buildScheduleOptions: () => null,
  },
  youtube: {
    keepsTitle: true,
    buildScheduleOptions: ({ platformOptions }) => ({
      privacyStatus: platformOptions.youtube?.privacyStatus ?? "public",
    }),
  },
  x: {
    keepsTitle: false,
    buildScheduleOptions: () => null,
  },
  facebook: {
    keepsTitle: false,
    buildScheduleOptions: () => null,
  },
};

// ────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────

/**
 * Orchestrates direct and scheduled posting across all platforms.
 *
 * Direct path (isScheduled=false): dispatches Inngest `post.now` events,
 * one per account x platform pair. processDirectPost worker handles
 * each, then writes content_history and cleans up media.
 *
 * Scheduled path (isScheduled=true): builds a SchedulePostData[] array
 * and calls schedulePostBatch (shared core for web/MCP/x402). One bulk
 * upsert into scheduled_posts. The processSinglePost worker fires later
 * when scheduled_at is reached.
 *
 * Accounts arrive as one mixed array (the caller no longer pre-groups by
 * platform); grouping and per-platform behavior live in
 * PLATFORM_FORM_ADAPTERS above.
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
  accounts: SocialAccount[];
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
    accounts,
    mediaPath,
    fileName,
    boards,
    accountContent,
    isScheduled,
    postType,
    userId,
    cleanupFiles = true,
    cronSecret,
  } = config;

  const requestId = generateRequestId();

  // Step 1: account count guard
  if (accounts.length === 0) {
    console.error("[handleSocialMediaPost] No accounts provided");
    return {
      success: false,
      counts: buildZeroCounts(),
      message:
        "No accounts selected for posting. Please select at least one account.",
      errors: [],
    };
  }

  console.log(
    `[handleSocialMediaPost] Starting ${isScheduled ? "scheduled" : "direct"} post for ${accounts.length} accounts`,
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
      counts: buildZeroCounts(),
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
      counts: buildZeroCounts(),
      message: "Too many requests. Please try again later.",
      resetIn: rateCheck.resetIn,
      errors: [],
    };
  }

  // Step 4: group accounts by platform; unknown platforms are reported,
  // never silently dropped.
  const accountsByPlatform = new Map<PostingPlatform, SocialAccount[]>();
  const unsupportedErrors: AccountError[] = [];
  for (const account of accounts) {
    if (!isPostingPlatform(account.platform)) {
      unsupportedErrors.push({
        accountId: account.id,
        platform: account.platform,
        displayName:
          account.display_name ?? account.username ?? account.id,
        error: `Posting to ${account.platform} is not supported`,
      });
      continue;
    }
    const group = accountsByPlatform.get(account.platform) ?? [];
    group.push(account);
    accountsByPlatform.set(account.platform, group);
  }
  if (unsupportedErrors.length > 0) {
    console.error(
      `[handleSocialMediaPost] ${unsupportedErrors.length} accounts on unsupported platforms`,
    );
    return {
      success: false,
      counts: buildZeroCounts(),
      message: "Some selected accounts are on unsupported platforms.",
      errors: unsupportedErrors,
    };
  }

  // Step 5: media presence validation. Every platform that accepts the
  // media post type needs the file; the batch cores enforce it again.
  if ((postType === "image" || postType === "video") && !mediaPath) {
    console.error(
      `[handleSocialMediaPost] Media required for ${postType} posts`,
    );
    return {
      success: false,
      counts: buildZeroCounts(),
      message: `${postType} posts require a media file`,
      errors: [],
    };
  }

  // Step 6: mime type derivation (used by direct path only)
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
        counts: buildZeroCounts(),
        message: mimeResult.message || "Failed to process media file.",
        errors: [],
      };
    }
    mediaType = mimeResult.mimeType;
  }

  // Step 7: content validation (Pinterest board, LinkedIn identifier, etc.)
  const missingContentAccounts: AccountError[] = [];
  for (const [platform, platformAccounts] of accountsByPlatform) {
    missingContentAccounts.push(
      ...validateAccountContent(
        platformAccounts,
        accountContent,
        platform,
        boards,
        postType,
      ),
    );
  }

  if (missingContentAccounts.length > 0) {
    console.error(
      `[handleSocialMediaPost] ${missingContentAccounts.length} accounts have invalid configuration`,
    );
    return {
      success: false,
      counts: buildZeroCounts(),
      message:
        "Some accounts have invalid configuration. Please check your settings.",
      errors: missingContentAccounts,
    };
  }

  // Step 8: branch on direct vs scheduled
  if (!isScheduled) {
    return directPostFromForm({
      accountsByPlatform,
      mediaPath,
      coverTimestamp: config.coverTimestamp,
      boards,
      platformOptions: config.platformOptions,
      accountContent,
      postType,
      userId: userId!,
      batchId: config.batchId,
      requestId,
    });
  }

  return scheduleAllPosts({
    accountsByPlatform,
    mediaPath,
    coverTimestamp: config.coverTimestamp,
    boards,
    platformOptions: config.platformOptions,
    accountContent,
    scheduledDate: config.scheduledDate ?? "",
    scheduledTime: config.scheduledTime ?? "",
    postType,
    userId: userId!,
    batchId: config.batchId,
    requestId,
  });
}

// ────────────────────────────────────────────────────────────
// Shared helpers for both paths
// ────────────────────────────────────────────────────────────

function findContentForAccount(
  accountContent: ContentInfo[],
  accountId: string,
): ContentInfo | undefined {
  return accountContent.find((content) => content.accountId === accountId);
}

function findSelectedBoard(
  boards: BoardInfo[] | undefined,
  accountId: string,
): BoardInfo | undefined {
  return boards?.find(
    (board) => board.accountId === accountId && board.isSelected,
  );
}

function buildAccountsLookup(
  accountsByPlatform: Map<PostingPlatform, SocialAccount[]>,
): Map<string, SocialAccount> {
  const lookup = new Map<string, SocialAccount>();
  for (const platformAccounts of accountsByPlatform.values()) {
    for (const account of platformAccounts) {
      lookup.set(account.id, account);
    }
  }
  return lookup;
}

function countAcceptedByPlatform(
  posts: { socialAccountId: string; platform: PostingPlatform }[],
  rejectedAccountIds: Set<string>,
): PlatformCounts {
  const counts = buildZeroCounts();
  for (const post of posts) {
    if (rejectedAccountIds.has(post.socialAccountId)) continue;
    counts[post.platform]++;
    counts.total++;
  }
  return counts;
}

function mapRejectionsToAccountErrors(
  rejections: { socialAccountId: string; reason: string }[],
  accountsLookup: Map<string, SocialAccount>,
): AccountError[] {
  return rejections.map((rejection) => {
    const account = accountsLookup.get(rejection.socialAccountId);
    return {
      accountId: rejection.socialAccountId,
      platform: account?.platform ?? "unknown",
      displayName:
        account?.display_name ??
        account?.username ??
        account?.id ??
        rejection.socialAccountId,
      error: rejection.reason,
    };
  });
}

// ────────────────────────────────────────────────────────────
// Scheduled-post bulk dispatch
// ────────────────────────────────────────────────────────────

/**
 * Builds a SchedulePostData[] from the platform groups and delegates to
 * schedulePostBatch for a single bulk upsert into scheduled_posts.
 * Platform/post-type combos the platform cannot publish (e.g. text on
 * Pinterest, image on YouTube) are skipped at build time; the account
 * selector already prevents selecting them.
 */
async function scheduleAllPosts(args: {
  accountsByPlatform: Map<PostingPlatform, SocialAccount[]>;
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
  requestId: string;
}): Promise<PostResult> {
  const scheduledAtIso = new Date(
    `${args.scheduledDate}T${args.scheduledTime}`,
  ).toISOString();

  const accountsLookup = buildAccountsLookup(args.accountsByPlatform);
  const posts: (SchedulePostData & { platform: PostingPlatform })[] = [];

  for (const [platform, platformAccounts] of args.accountsByPlatform) {
    if (!platformSupportsMediaType(platform, args.postType)) continue;
    const adapter = PLATFORM_FORM_ADAPTERS[platform];

    for (const account of platformAccounts) {
      const content = findContentForAccount(args.accountContent, account.id);
      if (!content) continue;
      const selectedBoard = findSelectedBoard(args.boards, account.id);

      posts.push({
        socialAccountId: account.id,
        platform,
        scheduledAt: scheduledAtIso,
        title: adapter.keepsTitle ? content.title : "",
        description: content.description,
        postType: args.postType,
        mediaStoragePath: args.mediaPath,
        coverTimestamp: args.coverTimestamp,
        batch_id: args.batchId,
        postOptions: adapter.buildScheduleOptions({
          account,
          content,
          platformOptions: args.platformOptions,
          selectedBoard,
        }),
      });
    }
  }

  if (posts.length === 0) {
    return {
      success: false,
      counts: buildZeroCounts(),
      message:
        "No posts to schedule after filtering. Check post type vs platform compatibility.",
      errors: [],
    };
  }

  const scheduleResult = await schedulePostBatch(
    posts,
    args.userId,
    "web",
    args.requestId,
  );

  const rejectedAccountIds = new Set(
    scheduleResult.details.rejected.map(
      (rejection) => rejection.socialAccountId,
    ),
  );

  const counts = scheduleResult.success
    ? countAcceptedByPlatform(posts, rejectedAccountIds)
    : buildZeroCounts();

  const errors = mapRejectionsToAccountErrors(
    scheduleResult.details.rejected,
    accountsLookup,
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
// Direct-post Inngest event dispatch
// ────────────────────────────────────────────────────────────

async function directPostFromForm(args: {
  accountsByPlatform: Map<PostingPlatform, SocialAccount[]>;
  mediaPath: string;
  coverTimestamp: number;
  boards?: BoardInfo[];
  platformOptions: PlatformOptions;
  accountContent: ContentInfo[];
  postType: MediaType;
  userId: string;
  batchId: string;
  requestId: string;
}): Promise<PostResult> {
  const accountsLookup = buildAccountsLookup(args.accountsByPlatform);
  const posts: (DirectPostData & { platform: PostingPlatform })[] = [];

  for (const [platform, platformAccounts] of args.accountsByPlatform) {
    if (!platformSupportsMediaType(platform, args.postType)) continue;

    for (const account of platformAccounts) {
      const content = findContentForAccount(args.accountContent, account.id);
      if (!content) continue;
      const selectedBoard = findSelectedBoard(args.boards, account.id);

      posts.push({
        socialAccountId: account.id,
        platform,
        postType: args.postType,
        title: content.title,
        description: content.description,
        mediaStoragePath: args.mediaPath,
        coverTimestamp: args.coverTimestamp,
        platformOptions: args.platformOptions,
        ...(platform === "pinterest"
          ? {
              pinterestBoardId: selectedBoard?.boardID,
              pinterestBoardName: selectedBoard?.boardName,
              pinterestLink: content.link || undefined,
            }
          : {}),
      });
    }
  }

  if (posts.length === 0) {
    return {
      success: false,
      counts: buildZeroCounts(),
      message: "No posts to dispatch.",
      errors: [],
    };
  }

  const result = await directPostBatch(
    posts,
    args.userId,
    "web",
    args.batchId,
    args.requestId,
  );

  const rejectedIds = new Set(
    result.details.rejected.map((rejection) => rejection.socialAccountId),
  );
  const counts = countAcceptedByPlatform(posts, rejectedIds);
  const errors = mapRejectionsToAccountErrors(
    result.details.rejected,
    accountsLookup,
  );

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
