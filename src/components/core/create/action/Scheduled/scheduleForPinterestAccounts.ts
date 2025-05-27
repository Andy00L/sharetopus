"use server";
import { schedulePost } from "@/actions/server/scheduleActions/schedulePost";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";

export interface ScheduleResult {
  success: boolean;
  count: number;
  message?: string;
}
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
  const {
    account,
    mediaPath,
    boards,
    platformOptions,
    scheduledDate,
    scheduledTime,
    accountContent,
    postType,
    userId,
    batchId,
  } = config;

  let successCount = 0;
  try {
    console.log("[Schedule For Pinterest Account] Starting to schedule posts");

    const postOptions = platformOptions.pinterest
      ? {
          ...platformOptions.pinterest,
          board: boards?.boardID,
          link: accountContent.link,
        }
      : null;

    const scheduleData = {
      socialAccountId: account.id,
      platform: account.platform,
      scheduledAt: new Date(`${scheduledDate}T${scheduledTime}`),
      title: accountContent.title, // Use account-specific title
      description: accountContent.description, // Use account-specific description
      postType: postType,
      mediaStoragePath: mediaPath,
      coverTimestamp: config.coverTimestamp,
      postOptions: postOptions,
      batch_id: batchId,
    };

    console.log(
      `[Schedule For Pinterest Account] Scheduling Pinterest post for: ${account.display_name}`
    );
    const result = await schedulePost(scheduleData, userId);

    if (!result.success) {
      return {
        success: false,
        count: successCount,
        message: `Failed to schedule for ${account.display_name}`,
      };
    } else {
      successCount++;
      console.log(
        `[Schedule For Pinterest Account] Successfully scheduled post for ${account.platform}:`,
        result
      );
    }

    return {
      success: true,
      count: successCount,
      message: `${successCount} Pinterest posts scheduled successfully`,
    };
  } catch (e) {
    console.error(
      `[Schedule For Pinterest Account] Schedule error for account ${account.id}:`,
      e
    );

    return {
      success: false,
      count: 0,
      message: `Failed to schedule Pinterest posts for ${account.display_name}`,
    };
  }
}
