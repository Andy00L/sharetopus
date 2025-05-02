"use server";
import { schedulePost } from "@/actions/server/scheduleActions/schedulePost";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { ScheduleResult } from "./scheduleForPinterestAccounts";

export async function scheduleForLinkedInAccounts(config: {
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
  batchId: string;
}): Promise<ScheduleResult> {
  const {
    accounts,
    mediaPath,
    scheduledDate,
    scheduledTime,
    accountContent,
    mediaType,
    userId,
    batchId,
  } = config;

  let successCount = 0;
  try {
    console.log("[Schedule For Linkedin Accounts] Starting to schedule posts");

    for (const account of accounts) {
      // Find the content specific to this account
      const content = accountContent.find(
        (item) => item.accountId === account.id
      );

      // Skip if no content found for this account (shouldn't happen)
      if (!content) {
        console.error(
          `[Schedule For Linkedin Accounts] No content found for account ${account.id}`
        );
        continue;
      }

      // Vérifier si le compte a un identifiant LinkedIn
      if (!account.account_identifier) {
        console.error(
          `[Schedule For Linkedin Accounts] No LinkedIn identifier found for account ${account.id}`
        );
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
        title: "",
        description: content.description, // Texte principal du post
        mediaType: mediaType,
        mediaStoragePath: mediaPath,
        postOptions: postOptions,
        batch_id: batchId,
      };

      try {
        console.log(
          `[Schedule For Linkedin Accounts] Scheduling TikTok post for: ${account.display_name}`
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
            `[Schedule For Linkedin Accounts]Successfully scheduled post for ${account.platform}:`,
            result
          );
        }
      } catch (scheduleError) {
        console.error(
          `[Schedule For Linkedin Accounts] Schedule error for account ${account.id}:`,
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
      message: `${successCount} LinkedIn posts scheduled successfully`,
    };
  } catch (e) {
    console.error("[Schedule For Linkedin Accounts] Error:", e);

    return {
      success: false,
      count: 0,
      message: `Failed to schedule LinkedIn posts`,
    };
  }
}
