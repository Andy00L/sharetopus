import "server-only";

import type { CreatedVia } from "@/db/schema";
import {
  buildDirectPostRefusal,
  directPostForAccountsGeneric,
  type DirectPostScheduleResult,
} from "@/lib/api/_shared/directPostForAccountsGeneric";
import { postToInstagram } from "@/lib/api/instagram/post/postToInstagram";
import type { InstagramPostResult } from "@/lib/api/instagram/post/postToInstagram";
import type { SocialAccount } from "@/lib/types/dbTypes";

const INSTAGRAM_ALT_TEXT_MAX_CHARS = 1_000;

interface InstagramDirectPostConfig {
  account: SocialAccount;
  coverTimestamp: number;
  accountContent: {
    accountId: string;
    title: string;
    description: string;
    isCustomized: boolean;
  };
  userId: string | null;
  mediaUrl: string;
  postType: "image" | "video";
  batchId: string;
  scheduledPostId?: string;
  createdVia: CreatedVia;
}

type InstagramPassthrough = {
  config: InstagramDirectPostConfig;
};

export async function directPostForInstagramAccounts(
  config: InstagramDirectPostConfig,
): Promise<DirectPostScheduleResult> {
  return directPostForAccountsGeneric<InstagramPassthrough, InstagramPostResult>(
    {
      platform: "instagram",
      logPrefix: "[Instagram Direct Post]",
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
      validate: (passthrough, genericConfig) => {
        if (genericConfig.accountContent.accountId !== genericConfig.account.id) {
          console.error(
            `[Instagram Direct Post] No or mismatched content for account ${genericConfig.account.id}`,
          );
          return buildDirectPostRefusal("No content found for account", "invalid_input");
        }
        if (!genericConfig.account.account_identifier) {
          return buildDirectPostRefusal(
            "Missing Instagram Business/Creator account ID",
            "invalid_input",
          );
        }
        if (!passthrough.config.mediaUrl) {
          return buildDirectPostRefusal(
            "Instagram requires media content. Please provide a public mediaUrl.",
            "invalid_input",
          );
        }
        return null;
      },
      call: async (accessToken, passthrough) =>
        postToInstagram({
          accessToken,
          igUserId: passthrough.config.account.account_identifier ?? "",
          caption: passthrough.config.accountContent.description,
          mediaUrl: passthrough.config.mediaUrl,
          postType: passthrough.config.postType === "video" ? "reel" : "image",
          coverTimestamp: passthrough.config.coverTimestamp,
          altText:
            passthrough.config.accountContent.description.slice(
              0,
              INSTAGRAM_ALT_TEXT_MAX_CHARS,
            ) || undefined,
          shareToFeed: true,
        }),
      toHistoryFields: (postResult, _passthrough, genericConfig) => ({
        content_id: postResult.postId,
        media_url: postResult.postUrl ?? null,
        status: "posted",
        extra: {
          container_id: postResult.containerId,
          post_type: genericConfig.postType,
          posted_at: new Date().toISOString(),
        },
      }),
    },
  );
}
