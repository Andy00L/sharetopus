"use server";
import { schedulePost } from "@/actions/server/scheduleActions/schedulePost";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { ScheduleResult } from "./scheduleForPinterestAccounts";

export async function scheduleForLinkedInAccounts(config: {
  account: SocialAccount;
  mediaPath: string;
  coverTimestamp?: number;

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
    scheduledDate,
    scheduledTime,
    accountContent,
    postType,
    userId,
    batchId,
  } = config;

  try {
    console.log("[Schedule For Linkedin Accounts] Starting to schedule posts");

    // Préparer les options spécifiques à LinkedIn si nécessaire
    // LinkedIn n'a pas besoin d'autant d'options que Pinterest
    const postOptions = {
      memberUrn: `urn:li:person:${account.account_identifier}`,
      link: accountContent.link || undefined,
      visibility: "PUBLIC", // Par défaut tous les posts sont publics
    };

    const scheduleData = {
      socialAccountId: account.id,
      platform: account.platform,
      scheduledAt: new Date(`${scheduledDate}T${scheduledTime}`),
      title: "",
      description: accountContent.description, // Texte principal du post
      postType: postType,
      mediaStoragePath: mediaPath,
      coverTimestamp: config.coverTimestamp,
      postOptions: postOptions,
      batch_id: batchId,
    };

    console.log(
      `[Schedule For Linkedin Accounts] Scheduling TikTok post for: ${account.display_name}`
    );
    const result = await schedulePost(scheduleData, userId);

    if (!result.success) {
      console.log(result.message);
      return {
        success: false,
        count: 0,
        message: `Failed to schedule for ${account.display_name}`,
      };
    }

    console.log(
      `[Schedule For Linkedin Accounts]Successfully scheduled post for ${account.platform}:`,
      result
    );

    return {
      success: true,
      count: 1,
      message: `LinkedIn post scheduled successfully`,
    };
  } catch (e) {
    console.error(
      "[Schedule For Linkedin Accounts] Schedule error for account ${account.id}:",
      e
    );

    return {
      success: false,
      count: 0,
      message: `Failed to schedule LinkedIn posts for ${account.display_name}`,
    };
  }
}
