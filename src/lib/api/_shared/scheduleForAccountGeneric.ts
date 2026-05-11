import "server-only";
import { schedulePostInternal } from "@/actions/server/_internal/scheduleActions/schedulePost";
import type { Platform } from "@/lib/types/database.types";
import type { SchedulePostData } from "@/lib/types/SchedulePostData";

export type ScheduleResult = {
  success: boolean;
  count: number;
  message?: string;
};

export type GenericScheduleConfig = {
  platform: Platform;
  logPrefix: string;
  socialAccountId: string;
  accountDisplayName: string;
  scheduledDate: string;
  scheduledTime: string;
  title: string;
  description: string;
  postType: "image" | "video" | "text";
  mediaStoragePath: string;
  coverTimestamp?: number;
  userId: string | null;
  batchId: string;
  postOptions: SchedulePostData["postOptions"];
};

export async function scheduleForAccountGeneric(
  config: GenericScheduleConfig
): Promise<ScheduleResult> {
  const { logPrefix, accountDisplayName, platform } = config;

  if (!config.userId) {
    return { success: false, count: 0, message: "Authentication required." };
  }

  try {
    console.log(`${logPrefix} Starting to schedule post`);

    const scheduleData = {
      socialAccountId: config.socialAccountId,
      platform: config.platform,
      scheduledAt: new Date(
        `${config.scheduledDate}T${config.scheduledTime}`
      ),
      title: config.title,
      description: config.description,
      postType: config.postType,
      mediaStoragePath: config.mediaStoragePath,
      coverTimestamp: config.coverTimestamp,
      postOptions: config.postOptions,
      batch_id: config.batchId,
    };

    console.log(
      `${logPrefix} Scheduling ${platform} post for: ${accountDisplayName}`
    );
    const result = await schedulePostInternal(
      scheduleData,
      config.userId,
      "web"
    );

    if (!result.success) {
      return {
        success: false,
        count: 0,
        message: `Failed to schedule for ${accountDisplayName}`,
      };
    }

    console.log(
      `${logPrefix} Successfully scheduled post for ${platform}`
    );
    return {
      success: true,
      count: 1,
      message: `${platform} post scheduled successfully`,
    };
  } catch (e) {
    console.error(
      `${logPrefix} Schedule error for account ${config.socialAccountId}:`,
      e instanceof Error ? e.message : e
    );
    return {
      success: false,
      count: 0,
      message: `Failed to schedule ${platform} posts for ${accountDisplayName}`,
    };
  }
}
