import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import type { ContentInfo } from "@/components/core/create/action/handleSocialMediaPost/handleSocialMediaPost";
import { scheduleForLinkedInAccounts } from "../schedule/scheduleForLinkedInAccounts";
import { processAccountsGeneric } from "@/lib/api/_shared/processAccountsGeneric";

export async function processLinkedinAccounts(config: {
  accounts: SocialAccount[];
  coverTimestamp?: number;
  mediaPath: string;
  mediaType: string;
  fileName: string;
  platformOptions: PlatformOptions;
  accountContent: ContentInfo[];
  isScheduled: boolean;
  scheduledDate: string;
  scheduledTime: string;
  postType: "image" | "video" | "text";
  userId: string | null;
  batchId: string;
  cronSecret?: string;
}) {
  return processAccountsGeneric<Record<string, never>>({
    platform: "linkedin",
    logPrefix: "[processLinkedinAccounts]:",
    accounts: config.accounts,
    accountContent: config.accountContent,
    isScheduled: config.isScheduled,
    postType: config.postType,
    resolvePerAccount: (account) => {
      if (!account.account_identifier) {
        return {
          ok: false,
          error: "No LinkedIn identifier found for this account",
        };
      }
      return { ok: true, extra: {} };
    },
    callScheduled: ({ account, accountContent }) =>
      scheduleForLinkedInAccounts({
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
      platformOptions: config.platformOptions,
      accountContent,
      postType: config.postType,
      userId: config.userId,
      fileName: config.fileName,
      batchId: config.batchId,
      cleanupFiles: false,
      cronSecret: config.cronSecret,
    }),
    directPostEndpoint: `${process.env.FRONTEND_URL}/api/social/linkedin/post`,
  });
}
