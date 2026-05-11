import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import type { ContentInfo } from "@/components/core/create/action/handleSocialMediaPost/handleSocialMediaPost";
import { scheduleForTikTokAccounts } from "../schedule/scheduleForTikTokAccounts";
import { processAccountsGeneric } from "@/lib/api/_shared/processAccountsGeneric";

export async function processTiktokAccounts(config: {
  accounts: SocialAccount[];
  mediaPath: string;
  coverTimestamp: number;
  mediaType: string;
  fileName: string;
  tiktokMediaUrl: string;
  platformOptions: PlatformOptions;
  accountContent: ContentInfo[];
  isScheduled: boolean;
  scheduledDate: string;
  scheduledTime: string;
  postType: "image" | "video" | "text";
  userId: string | null;
  batchId: string;
  cronSecret: string | undefined;
}) {
  return processAccountsGeneric<{ tiktokMediaUrl: string }>({
    platform: "tiktok",
    logPrefix: "[processTiktokAccounts]:",
    accounts: config.accounts,
    accountContent: config.accountContent,
    isScheduled: config.isScheduled,
    postType: config.postType,
    resolvePerAccount: () => ({
      ok: true,
      extra: { tiktokMediaUrl: config.tiktokMediaUrl },
    }),
    callScheduled: ({ account, accountContent }) =>
      scheduleForTikTokAccounts({
        account,
        mediaPath: config.mediaPath,
        coverTimestamp: config.coverTimestamp,
        platformOptions: config.platformOptions,
        accountContent,
        scheduledDate: config.scheduledDate,
        scheduledTime: config.scheduledTime,
        postType: config.postType,
        userId: config.userId,
        batchId: config.batchId,
      }),
    buildDirectPostBody: ({ account, accountContent }) => ({
      account,
      mediaPath: config.mediaPath,
      coverTimestamp: config.coverTimestamp,
      mediaType: config.mediaType,
      postType: config.postType,
      tiktokMediaUrl: config.tiktokMediaUrl,
      platformOptions: config.platformOptions,
      accountContent,
      userId: config.userId,
      fileName: config.fileName,
      batchId: config.batchId,
      cronSecret: config.cronSecret,
    }),
    directPostEndpoint: `${process.env.FRONTEND_URL}/api/social/tiktok/post`,
  });
}
