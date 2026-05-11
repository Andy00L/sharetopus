import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import type {
  BoardInfo,
  ContentInfo,
} from "@/components/core/create/action/handleSocialMediaPost/handleSocialMediaPost";
import { scheduleForPinterestAccount } from "../../pinterest/schedule/scheduleForPinterestAccounts";
import { processAccountsGeneric } from "@/lib/api/_shared/processAccountsGeneric";

export async function processPinterestAccounts(config: {
  accounts: SocialAccount[];
  mediaPath: string;
  coverTimestamp: number;
  mediaType: string;
  fileName: string;
  boards: BoardInfo[];
  platformOptions: PlatformOptions;
  accountContent: ContentInfo[];
  isScheduled: boolean;
  scheduledDate: string;
  scheduledTime: string;
  postType: "image" | "video" | "text";
  userId: string | null;
  batchId: string;
  cronSecret?: string;
  mediaUrl: string;
}) {
  return processAccountsGeneric<BoardInfo>({
    platform: "pinterest",
    logPrefix: "[processPinterestAccounts]:",
    accounts: config.accounts,
    accountContent: config.accountContent,
    isScheduled: config.isScheduled,
    postType: config.postType,
    skipBatch: config.postType === "text",
    resolvePerAccount: (account) => {
      const accountBoards = config.boards.filter(
        (b) => b.accountId === account.id && b.isSelected
      );
      if (accountBoards.length === 0) {
        return { ok: false, error: "No board selected for this account" };
      }
      return { ok: true, extra: accountBoards[0] };
    },
    callScheduled: ({ account, accountContent, extra: board }) =>
      scheduleForPinterestAccount({
        account,
        mediaPath: config.mediaPath,
        coverTimestamp: config.coverTimestamp,
        boards: board,
        platformOptions: config.platformOptions,
        accountContent,
        scheduledDate: config.scheduledDate,
        scheduledTime: config.scheduledTime,
        postType: config.postType,
        userId: config.userId,
        batchId: config.batchId,
      }),
    buildDirectPostBody: ({ account, accountContent, extra: board }) => ({
      account,
      mediaPath: config.mediaPath,
      coverTimestamp: config.coverTimestamp,
      mediaType: config.mediaType,
      boards: board,
      platformOptions: config.platformOptions,
      accountContent,
      userId: config.userId,
      fileName: config.fileName,
      batchId: config.batchId,
      postType: config.postType,
      cronSecret: config.cronSecret,
      mediaUrl: config.mediaUrl,
    }),
    directPostEndpoint: `${process.env.FRONTEND_URL}/api/social/pinterest/post`,
  });
}
