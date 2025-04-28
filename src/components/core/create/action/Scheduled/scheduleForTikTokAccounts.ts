"use server";
import { schedulePost } from "@/actions/server/scheduleActions/schedulePost";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { ScheduleResult } from "./scheduleForPinterestAccounts";

export async function scheduleForTikTokAccounts(config: {
  accounts: SocialAccount[];
  mediaPath: string;
  platformOptions: PlatformOptions;
  accountContent: Array<{
    accountId: string;
    title?: string;
    description: string;
    link: string;
    isCustomized: boolean;
  }>;
  scheduledDate: string;
  scheduledTime: string;

  mediaType: "image" | "video" | "text";
  userId: string | null;
}): Promise<ScheduleResult> {
  const {
    accounts,
    mediaPath,
    platformOptions,
    scheduledDate,
    scheduledTime,
    accountContent,
    mediaType,
    userId,
  } = config;

  let successCount = 0;
  try {
    console.log("[Schedule For Tiktok Accounts] Starting to schedule posts");

    for (const account of accounts) {
      // Find the content specific to this account
      const content = accountContent.find(
        (item) => item.accountId === account.id
      );

      // Skip if no content found for this account (shouldn't happen)
      if (!content) {
        console.error(
          `[Schedule For Tiktok Accounts] No content found for account ${account.id}`
        );
        continue;
      }

      const scheduleData = {
        socialAccountId: account.id,
        platform: account.platform,
        scheduledAt: new Date(`${scheduledDate}T${scheduledTime}`),
        description: content.description,
        mediaType: mediaType,
        mediaStoragePath: mediaPath,
        postOptions: platformOptions.tiktok || null,
      };

      try {
        console.log(
          `[Schedule For Tiktok Accounts] Scheduling TikTok post for: ${account.display_name}`
        );
        const result = await schedulePost(scheduleData, userId);

        if (!result.success) {
          console.log(result.message);
          return {
            success: false,
            count: successCount,
            message: `Failed to schedule for ${account.display_name}`,
          };
        } else {
          successCount++;
          console.log(
            `[Schedule For Tiktok Accounts] Successfully scheduled post for ${account.platform}:`,
            result
          );
        }
      } catch (scheduleError) {
        console.error(
          `[Schedule For Tiktok Accounts] Schedule error for account ${account.id}:`,
          scheduleError
        );
        return {
          success: false,
          count: successCount,
          message: `Error scheduling for ${account.display_name}`,
        };
      }
    }
    return {
      success: true,
      count: successCount,
      message: `${successCount} Tiktok posts scheduled successfully`,
    };
  } catch (e) {
    console.error("[Schedule For Tiktok Accounts] Error:", e);

    return {
      success: false,
      count: 0,
      message: `Failed to schedule Pinterest posts`,
    };
  }
}
