import "server-only";

import {
  buildDirectPostRefusal,
  directPostForAccountsGeneric,
  type DirectPostScheduleResult,
} from "@/lib/api/_shared/directPostForAccountsGeneric";
import { postToFacebook } from "@/lib/api/facebook/post/postToFacebook";
import type { FacebookPostResult } from "@/lib/api/facebook/post/postToFacebook";
import type { CreatedVia, MediaType } from "@/db/schema";
import type { SocialAccount } from "@/lib/types/dbTypes";

interface FacebookDirectPostConfig {
  account: SocialAccount;
  mediaPath: string;
  accountContent: {
    accountId: string;
    title?: string;
    description: string;
  };
  userId: string | null;
  mediaUrl: string;
  batchId: string;
  postType: MediaType;
  scheduledPostId?: string;
  createdVia: CreatedVia;
}

type FacebookPassthrough = {
  config: FacebookDirectPostConfig;
};

export async function directPostForFacebookAccounts(
  config: FacebookDirectPostConfig,
): Promise<DirectPostScheduleResult> {
  return directPostForAccountsGeneric<FacebookPassthrough, FacebookPostResult>(
    {
      platform: "facebook",
      logPrefix: "[Facebook Direct Post]",
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
        if (!passthrough.config.account.account_identifier) {
          return buildDirectPostRefusal(
            "No Facebook Page id found for account",
            "invalid_input",
          );
        }
        if (
          passthrough.config.postType !== "text" &&
          !passthrough.config.mediaUrl
        ) {
          return buildDirectPostRefusal(
            "Media URL is required for Facebook image and video posts",
            "invalid_input",
          );
        }
        return null;
      },
      call: async (accessToken, passthrough) =>
        postToFacebook({
          pageAccessToken: accessToken,
          pageId: passthrough.config.account.account_identifier,
          message: passthrough.config.accountContent.description,
          mediaUrl: passthrough.config.mediaUrl || undefined,
          postType: passthrough.config.postType,
        }),
      toHistoryFields: (postResult, _passthrough, adapterConfig) => ({
        content_id: postResult.postId ?? "",
        media_url: postResult.postUrl ?? null,
        status: "posted",
        extra: {
          post_type: adapterConfig.postType,
          posted_at: new Date().toISOString(),
        },
      }),
    },
  );
}
