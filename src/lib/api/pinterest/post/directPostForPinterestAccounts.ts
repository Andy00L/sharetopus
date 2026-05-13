import "server-only";
import { postToPinterest } from "@/lib/api/pinterest/post/postToPinterest";
import type { PinterestPostResult } from "@/lib/api/pinterest/post/postToPinterest";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import {
  directPostForAccountsGeneric,
  type DirectPostScheduleResult,
} from "@/lib/api/_shared/directPostForAccountsGeneric";
import { CreatedVia, MediaType } from "@/lib/types/database.types";

interface PinterestDirectPostConfig {
  account: SocialAccount;
  mediaPath: string;
  coverTimestamp: number;
  boards: {
    boardID: string;
    boardName: string;
    accountId: string;
    isSelected: boolean;
  };
  platformOptions: PlatformOptions;
  accountContent: {
    accountId: string;
    title: string;
    description: string;
    link: string;
    isCustomized: boolean;
  };
  userId: string | null;
  fileName: string;
  batchId: string;
  mediaType: string;
  postType: MediaType;
  mediaUrl: string;
  scheduledPostId?: string;
  createdVia: CreatedVia;
}

type PinterestPassthrough = {
  config: PinterestDirectPostConfig;
};

export async function directPostForPinterestAccounts(
  config: PinterestDirectPostConfig,
): Promise<DirectPostScheduleResult> {
  return directPostForAccountsGeneric<
    PinterestPassthrough,
    PinterestPostResult
  >(
    {
      platform: "pinterest",
      logPrefix: "[Pinterest Direct Post]",
      account: config.account,
      accountContent: config.accountContent,
      userId: config.userId ?? "",
      batchId: config.batchId,
      scheduledPostId: config.scheduledPostId ?? null,
      postType: config.postType,
      createdVia: config.createdVia,
    },
    { config },
    {
      call: async (accessToken, pt) =>
        postToPinterest({
          accessToken,
          boardId: pt.config.boards.boardID,
          title: pt.config.accountContent.title,
          description: pt.config.accountContent.description,
          link: pt.config.accountContent.link,
          mediaPath: pt.config.mediaPath,
          mediaType: pt.config.mediaType,
          fileName: pt.config.fileName,
          userId: pt.config.userId ?? "",
          coverTimestamp: pt.config.coverTimestamp,
          postType: pt.config.postType,
          mediaUrl: pt.config.mediaUrl,
        }),
      toHistoryFields: (postResult, pt, cfg) => ({
        content_id: postResult.postId ?? "",
        media_url: postResult.postUrl ?? null,
        status: "posted",
        extra: {
          post_data: postResult.data,
          post_type: cfg.postType,
          posted_at: new Date().toISOString(),
          board_id: pt.config.boards.boardID,
          board_name: pt.config.boards.boardName,
        },
      }),
    },
  );
}
