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
  link: string;
  scheduledDate: string;
  scheduledTime: string;
  title: string;
  description: string;
  mediaType: "image" | "video" | "text";
  userId: string | null;
}): Promise<number> {
  const {
    accounts,
    mediaPath,
    boards,
    platformOptions,
    link,
    scheduledDate,
    scheduledTime,
    title,
    description,
    mediaType,
    userId,
  } = config;

  let successCount = 0;

  for (const account of accounts) {
    const selectedBoard = boards.find(
      (board) => board.isSelected && board.accountId === account.id
    );

    const postOptions = platformOptions.pinterest
      ? {
          ...platformOptions.pinterest,
          board: selectedBoard?.boardID,
          link: link,
        }
      : null;

    const scheduleData = {
      socialAccountId: account.id,
      platform: account.platform,
      scheduledAt: new Date(`${scheduledDate}T${scheduledTime}`),
      title: title,
      description: description,
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
    }
  }

  return successCount;
}
