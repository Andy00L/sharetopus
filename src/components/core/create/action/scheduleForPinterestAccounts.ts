import { schedulePost } from "@/actions/server/scheduleActions/schedulePost";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { toast } from "sonner";

export async function scheduleForPinterestAccounts(config: {
  accounts: SocialAccount[];
  mediaPath: string;
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
  mediaType: "image" | "video" | "text";
  userId: string | null;
}): Promise<number> {
  const {
    accounts,
    mediaPath,
    boards,
    platformOptions,
    scheduledDate,
    scheduledTime,
    accountContent,
    mediaType,
    userId,
  } = config;

  let successCount = 0;

  for (const account of accounts) {
    // Find the content specific to this account
    const content = accountContent.find(
      (item) => item.accountId === account.id
    );

    // Skip if no content found for this account (shouldn't happen)
    if (!content) {
      console.error(`No content found for account ${account.id}`);
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
      mediaType: mediaType,
      mediaStoragePath: mediaPath,
      postOptions: postOptions,
    };

    try {
      const result = await schedulePost(scheduleData, userId);

      if (!result.success) {
        toast.error(
          `Failed to schedule for ${account.display_name}: ${result.message}`
        );
      } else {
        successCount++;
        console.log(
          `Successfully scheduled post for ${account.platform}:`,
          result
        );
      }
    } catch (scheduleError) {
      console.error(`Schedule error for account ${account.id}:`, scheduleError);
      toast.error(`Error scheduling for ${account.display_name}`);
      throw scheduleError;
    }
  }

  return successCount;
}
