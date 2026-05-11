"use server";
import { schedulePostInternal } from "@/actions/server/_internal/scheduleActions/schedulePost";
import { SocialAccount } from "@/lib/types/dbTypes";
import type { ScheduleResult } from "@/lib/api/_shared/scheduleForAccountGeneric";

export async function scheduleForInstagramAccounts(config: {
  account: SocialAccount;
  mediaPath: string;
  coverTimestamp: number;
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
  const {
    account,
    mediaPath,
    scheduledDate,
    scheduledTime,
    accountContent,
    postType,
    userId,
    batchId,
  } = config;

  let successCount = 0;
  try {
    console.log("[Schedule For Instagram Accounts] Starting to schedule posts");

    const scheduleData = {
      socialAccountId: account.id,
      platform: account.platform,
      scheduledAt: new Date(`${scheduledDate}T${scheduledTime}`),
      description: accountContent.description,
      postType: postType,
      mediaStoragePath: mediaPath,
      coverTimestamp: config.coverTimestamp,
      postOptions: null,
      batch_id: batchId,
    };

    if (!userId) {
      return { success: false, count: 0, message: "Authentication required." };
    }

    console.log(
      `[Schedule For Instagram Accounts] Scheduling Instagram post for: ${account.display_name}`
    );

    const result = await schedulePostInternal(scheduleData, userId, "web");

    if (!result.success) {
      return {
        success: false,
        count: successCount,
        message: `Failed to schedule for ${account.display_name}`,
      };
    } else {
      successCount++;
      console.log(
        `[Schedule For Instagram Accounts] Successfully scheduled post for ${account.platform}:`,
        result
      );
    }

    return {
      success: true,
      count: successCount,
      message: `${successCount} Instagram posts scheduled successfully`,
    };
  } catch (e) {
    console.error(
      `[Schedule For Instagram Accounts] Schedule error for account ${account.id}:`,
      e
    );

    return {
      success: false,
      count: 0,
      message: `Failed to schedule Instagram posts for ${account.display_name}`,
    };
  }
}
