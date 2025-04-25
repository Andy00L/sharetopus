import { schedulePost } from "@/actions/server/scheduleActions/schedulePost";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { toast } from "sonner";

export async function scheduleForTikTokAccounts(config: {
  accounts: SocialAccount[];
  mediaPath: string;
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

    const scheduleData = {
      socialAccountId: account.id,
      platform: account.platform,
      scheduledAt: new Date(`${scheduledDate}T${scheduledTime}`),
      title: content.title, // Use account-specific title
      description: content.description,
      mediaType: mediaType,
      mediaStoragePath: mediaPath,
      postOptions: platformOptions.tiktok || null,
    };

    try {
      console.log(`Scheduling TikTok post for: ${account.display_name}`);
      const result = await schedulePost(scheduleData, userId);

      if (!result.success) {
        toast.error(`Failed to schedule: ${result.message}`);
      } else {
        successCount++;
        toast.success(`Post scheduled for: ${account.display_name}`);
      }
    } catch (error) {
      console.error(`Schedule error for TikTok account:`, error);
      toast.error(`Unexpected error scheduling for ${account.display_name}`);
      throw error;
    }
  }

  return successCount;
}
