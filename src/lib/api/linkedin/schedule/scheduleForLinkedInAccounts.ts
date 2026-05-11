"use server";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import type { ScheduleResult } from "@/lib/api/_shared/scheduleForAccountGeneric";
import { scheduleForAccountGeneric } from "@/lib/api/_shared/scheduleForAccountGeneric";

export async function scheduleForLinkedInAccounts(config: {
  account: SocialAccount;
  mediaPath: string;
  coverTimestamp?: number;
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
  const postOptions = {
    memberUrn: `urn:li:person:${config.account.account_identifier}`,
    link: config.accountContent.link || undefined,
    visibility: "PUBLIC",
  };

  return scheduleForAccountGeneric({
    platform: "linkedin",
    logPrefix: "[Schedule For Linkedin Accounts]",
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
    postOptions,
  });
}
