import "server-only";

import type { CreatedVia, MediaType } from "@/db/schema";
import {
  buildDirectPostRefusal,
  directPostForAccountsGeneric,
  type DirectPostScheduleResult,
} from "@/lib/api/_shared/directPostForAccountsGeneric";
import { postToPinterest } from "@/lib/api/pinterest/post/postToPinterest";
import type { PinterestPostResult } from "@/lib/api/pinterest/post/postToPinterest";
import type { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";

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
  return directPostForAccountsGeneric<PinterestPassthrough, PinterestPostResult>(
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
      validate: (passthrough) => {
        const { postType, boards, mediaUrl, mediaPath } = passthrough.config;
        if (!boards.boardID) {
          return buildDirectPostRefusal("No board selected for Pinterest", "invalid_input");
        }
        if (postType === "text") {
          return buildDirectPostRefusal(
            "Pinterest does not support text posts",
            "invalid_input",
          );
        }
        if (postType === "image" && !mediaUrl) {
          return buildDirectPostRefusal(
            "Media URL is required for Pinterest image pins",
            "invalid_input",
          );
        }
        if (postType === "video" && !mediaPath) {
          return buildDirectPostRefusal(
            "Media file is required for Pinterest video pins",
            "invalid_input",
          );
        }
        return null;
      },
      call: async (accessToken, passthrough) =>
        postToPinterest({
          accessToken,
          boardId: passthrough.config.boards.boardID,
          title: passthrough.config.accountContent.title,
          description: passthrough.config.accountContent.description,
          link: passthrough.config.accountContent.link,
          mediaPath: passthrough.config.mediaPath,
          mediaType: passthrough.config.mediaType,
          fileName: passthrough.config.fileName,
          coverTimestamp: passthrough.config.coverTimestamp,
          postType: passthrough.config.postType,
          mediaUrl: passthrough.config.mediaUrl,
        }),
      toHistoryFields: (postResult, passthrough, genericConfig) => ({
        content_id: postResult.postId,
        media_url: postResult.postUrl,
        status: "posted",
        extra: {
          post_data: postResult.data,
          post_type: genericConfig.postType,
          posted_at: new Date().toISOString(),
          board_id: passthrough.config.boards.boardID,
          board_name: passthrough.config.boards.boardName,
        },
      }),
    },
  );
}
