"use server";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import type { ScheduleResult } from "@/lib/api/_shared/scheduleForAccountGeneric";
import { scheduleForAccountGeneric } from "@/lib/api/_shared/scheduleForAccountGeneric";

export async function scheduleForPinterestAccount(config: {
  account: SocialAccount;
  mediaPath: string;
  coverTimestamp: number;
  boards: {
    boardID: string;
    boardName: string;
    accountId: string;
    isSelected: boolean;
  };
  platformOptions: PlatformOptions;
  accountContent: {
    accountId: string;
    title: string;
    description: string;
    link: string;
    isCustomized: boolean;
  };
  scheduledDate: string;
  scheduledTime: string;
  postType: "image" | "video" | "text";
  userId: string | null;
  batchId: string;
}): Promise<ScheduleResult> {
  const postOptions = config.platformOptions.pinterest
    ? {
        ...config.platformOptions.pinterest,
        board: config.boards?.boardID,
        link: config.accountContent.link,
      }
    : null;

  return scheduleForAccountGeneric({
    platform: "pinterest",
    logPrefix: "[Schedule For Pinterest Account]",
    socialAccountId: config.account.id,
    accountDisplayName:
      config.account.display_name ?? config.account.username ?? config.account.id,
    scheduledDate: config.scheduledDate,
    scheduledTime: config.scheduledTime,
    title: config.accountContent.title,
    description: config.accountContent.description,
    postType: config.postType,
    mediaStoragePath: config.mediaPath,
    coverTimestamp: config.coverTimestamp,
    userId: config.userId,
    batchId: config.batchId,
    postOptions,
  });
}
