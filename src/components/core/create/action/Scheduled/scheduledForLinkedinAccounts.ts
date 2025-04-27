import { schedulePost } from "@/actions/server/scheduleActions/schedulePost";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { toast } from "sonner";

export interface ScheduleResult {
  success: boolean;
  count: number;
  message?: string;
}

export async function scheduleForLinkedInAccounts(config: {
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
}): Promise<ScheduleResult> {
  const {
    accounts,
    mediaPath,
    scheduledDate,
    scheduledTime,
    accountContent,
    mediaType,
    userId,
  } = config;

  let successCount = 0;
  try {
    console.log("[LinkedIn Scheduler] Starting to schedule posts");

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

      // Vérifier si le compte a un identifiant LinkedIn
      if (!account.account_identifier) {
        console.error(`No LinkedIn identifier found for account ${account.id}`);
        continue;
      }

      // Préparer les options spécifiques à LinkedIn si nécessaire
      // LinkedIn n'a pas besoin d'autant d'options que Pinterest
      const postOptions = {
        memberUrn: `urn:li:person:${account.account_identifier}`,
        link: content.link || undefined,
        visibility: "PUBLIC", // Par défaut tous les posts sont publics
      };

      const scheduleData = {
        socialAccountId: account.id,
        platform: account.platform,
        scheduledAt: new Date(`${scheduledDate}T${scheduledTime}`),
        title: content.title, // Utilisé comme titre pour les liens/images
        description: content.description, // Texte principal du post
        mediaType: mediaType,
        mediaStoragePath: mediaPath,
        postOptions: postOptions,
      };

      try {
        const result = await schedulePost(scheduleData, userId);

        if (!result.success) {
          toast.error(
            `Failed to schedule for ${
              account.display_name ?? account.username
            }: ${result.message}`
          );
        } else {
          successCount++;
          console.log(
            `Successfully scheduled post for ${account.platform}:`,
            result
          );
        }
      } catch (scheduleError) {
        console.error(
          `Schedule error for account ${account.id}:`,
          scheduleError
        );
        toast.error(
          `Error scheduling for ${account.display_name ?? account.username}`
        );
        throw scheduleError;
      }
    }
    return {
      success: true,
      count: successCount,
      message: `${successCount} LinkedIn posts scheduled successfully`,
    };
  } catch (e) {
    console.error("[LinkedIn Scheduler] Error:", e);

    return {
      success: false,
      count: 0,
      message: `Failed to schedule LinkedIn posts: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
}
