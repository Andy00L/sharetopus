"use server";

import { authCheck } from "@/actions/server/authCheck";
import { authCheckCronJob } from "@/actions/server/authCheckCronJob";
import { deleteSupabaseFileAction } from "@/actions/server/data/storageFiles/deleteSupabaseFileAction";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { schedulePostBatch } from "@/actions/server/scheduleActions/schedule/schedulePostBatch";
import {
  isPostingPlatform,
  type PostingPlatform,
} from "@/lib/platforms/capabilities";
import type { MediaType } from "@/db/schema";
import { encodeFormPostOptions } from "@/inngest/events/postOptions";
import { generateRequestId } from "@/lib/utils/generateRequestId";
import { ClientSocialAccount, PlatformOptions } from "@/lib/types/dbTypes";
import type { SchedulePostData } from "@/lib/types/SchedulePostData";
import { getMimeTypeFromFileName } from "../../../lib/utils/getMimeTypeFromFileName";
import {
  directPostBatch,
  DirectPostData,
} from "../directPostActions/directPostBatch";
import { generateSuccessMessage } from "./successMessage";
import { validateAccountContent } from "./validateContent";

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
  return {
    total: 0,
    linkedin: 0,
    tiktok: 0,
    pinterest: 0,
    instagram: 0,
    youtube: 0,
    x: 0,
    facebook: 0,
  };
}

const PLATFORM_KEEPS_TITLE: Record<PostingPlatform, boolean> = {
  pinterest: true,
  linkedin: false,
  tiktok: false,
  instagram: false,
  youtube: true,
  x: false,
  facebook: false,
};

export async function handleSocialMediaPost(config: {
  accounts: ClientSocialAccount[];
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
      message: rateCheck.message,
      resetIn: rateCheck.resetIn,
      errors: [],
    };
  }

  const accountsByPlatform = new Map<PostingPlatform, ClientSocialAccount[]>();
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
  }

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
  accountsByPlatform: Map<PostingPlatform, ClientSocialAccount[]>,
): Map<string, ClientSocialAccount> {
  const lookup = new Map<string, ClientSocialAccount>();
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
  accountsLookup: Map<string, ClientSocialAccount>,
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

async function scheduleAllPosts(args: {
  accountsByPlatform: Map<PostingPlatform, ClientSocialAccount[]>;
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
    for (const account of platformAccounts) {
      const content = findContentForAccount(args.accountContent, account.id);
      if (!content) continue;
      const selectedBoard = findSelectedBoard(args.boards, account.id);

      posts.push({
        socialAccountId: account.id,
        platform,
        scheduledAt: scheduledAtIso,
        title: PLATFORM_KEEPS_TITLE[platform] ? content.title : "",
        description: content.description,
        postType: args.postType,
        mediaStoragePath: args.mediaPath,
        coverTimestamp: args.coverTimestamp,
        batch_id: args.batchId,
        postOptions: encodeFormPostOptions({
          platform,
          link: content.link,
          platformOptions: args.platformOptions,
          pinterestBoard: selectedBoard
            ? { boardId: selectedBoard.boardID, boardName: selectedBoard.boardName }
            : null,
        }),
      });
    }
  }

  if (posts.length === 0) {
    return {
      success: false,
      counts: buildZeroCounts(),
      message:
        "No posts to schedule.",
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

async function directPostFromForm(args: {
  accountsByPlatform: Map<PostingPlatform, ClientSocialAccount[]>;
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
        link: content.link || undefined,
        ...(platform === "pinterest"
          ? {
              pinterestBoardId: selectedBoard?.boardID,
              pinterestBoardName: selectedBoard?.boardName,
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
