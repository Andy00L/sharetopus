"use server";
import { schedulePost } from "@/actions/server/scheduleActions/schedulePost";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";

export interface ScheduleResult {
  success: boolean;
  count: number;
  message?: string;
}
export async function scheduleForPinterestAccounts(config: {
  accounts: SocialAccount[];
  mediaPath: string;
  coverStoragePath?: string;
  boards: Array<{
    boardID: string;
    boardName: string;
    accountId: string;
    isSelected: boolean;
  }>;
  platformOptions: PlatformOptions;
  accountContent: Array<{
    accountId: string;
    title: string;
    description: string;
    link: string;
    isCustomized: boolean;
  }>;

  scheduledDate: string;
  scheduledTime: string;
  postType: "image" | "video" | "text";
  userId: string | null;
  batchId: string;
  coverImagePath?: string;
}): Promise<ScheduleResult> {
  const {
    accounts,
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
    console.log("[Schedule For Pinterest Accounts] Starting to schedule posts");
    for (const account of accounts) {
      // Find the content specific to this account
      const content = accountContent.find(
        (item) => item.accountId === account.id
      );

      // Skip if no content found for this account (shouldn't happen)
      if (!content) {
        console.error(
          `[Schedule For Pinterest Accounts] No content found for account ${account.id}`
        );
        continue;
      }

      const selectedBoard = boards.find(
        (board) => board.isSelected && board.accountId === account.id
      );

      const postOptions = platformOptions.pinterest
        ? {
            ...platformOptions.pinterest,
            board: selectedBoard?.boardID,
            link: content.link,
          }
        : null;

      const scheduleData = {
        socialAccountId: account.id,
        platform: account.platform,
        scheduledAt: new Date(`${scheduledDate}T${scheduledTime}`),
        title: content.title, // Use account-specific title
        description: content.description, // Use account-specific description
        postType: postType,
        mediaStoragePath: mediaPath,
        coverStoragePath: config.coverImagePath,
        postOptions: postOptions,
        batch_id: batchId,
      };

      try {
        console.log(
          `[Schedule For Pinterest Accounts] Scheduling Pinterest post for: ${account.display_name}`
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
            `[Schedule For Pinterest Accounts] Successfully scheduled post for ${account.platform}:`,
            result
          );
        }
      } catch (scheduleError) {
        console.error(
          `[Schedule For Pinterest Accounts] Schedule error for account ${account.id}:`,
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
      message: `${successCount} Pinterest posts scheduled successfully`,
    };
  } catch (e) {
    console.error("[Schedule For Pinterest Accounts]  Error:", e);

    return {
      success: false,
      count: 0,
      message: `Failed to schedule Pinterest posts`,
    };
  }
}
