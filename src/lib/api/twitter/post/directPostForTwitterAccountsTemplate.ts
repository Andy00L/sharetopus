/**
 * TEMPLATE: Twitter direct-post function.
 *
 * This file is a scaffold for future Twitter/X integration. It follows
 * the same shape as directPostForInstagramAccounts so a future
 * implementation can fill in the API calls without restructuring.
 *
 * DO NOT wire this into processSinglePostHelpers.ts or any platform
 * switch until a real Twitter API integration exists.
 */
import "server-only";

import type { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import type { ScheduleResult } from "../../pinterest/schedule/scheduleForPinterestAccounts";

export async function directPostForTwitterAccountsTemplate(config: {
  account: SocialAccount;
  mediaPath: string;
  coverTimestamp: number;
  mediaType: string;
  accountContent: {
    accountId: string;
    title: string;
    description: string;
    isCustomized: boolean;
  };
  userId: string | null;
  mediaUrl: string;
  postType: "image" | "video" | "text";
  fileName: string;
  batchId: string;
  platformOptions: PlatformOptions;
  scheduledPostId?: string;
}): Promise<ScheduleResult> {
  console.log(
    "[Twitter Direct Post] Template invoked (not implemented)",
    { account: config.account.id }
  );

  return {
    success: false,
    count: 0,
    message: "Twitter posting is not yet implemented",
  };
}
