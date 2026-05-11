"use server";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import {
  scheduleForAccountGeneric,
  type ScheduleResult,
} from "@/lib/api/_shared/scheduleForAccountGeneric";

export type { ScheduleResult };

export async function scheduleForTikTokAccounts(config: {
  account: SocialAccount;
  mediaPath: string;
  coverTimestamp: number;
  platformOptions: PlatformOptions;
  accountContent: {
    accountId: string;
    title?: string;
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
  return scheduleForAccountGeneric({
    platform: "tiktok",
    logPrefix: "[Schedule For Tiktok Accounts]",
    socialAccountId: config.account.id,
    accountDisplayName:
      config.account.display_name ?? config.account.username ?? config.account.id,
    scheduledDate: config.scheduledDate,
    scheduledTime: config.scheduledTime,
    title: "",
    description: config.accountContent.description,
    postType: config.postType,
    mediaStoragePath: config.mediaPath,
    coverTimestamp: config.coverTimestamp,
    userId: config.userId,
    batchId: config.batchId,
    postOptions: config.platformOptions.tiktok ?? null,
  });
}
