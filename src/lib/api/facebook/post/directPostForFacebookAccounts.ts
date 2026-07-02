import "server-only";

import {
  directPostForAccountsGeneric,
  type DirectPostScheduleResult,
} from "@/lib/api/_shared/directPostForAccountsGeneric";
import { postToFacebook } from "@/lib/api/facebook/post/postToFacebook";
import type { FacebookPostResult } from "@/lib/api/facebook/post/postToFacebook";
import type { CreatedVia, MediaType } from "@/lib/types/database.types";
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
  /** Public signed URL Facebook pulls media from; empty for text posts. */
  mediaUrl: string;
  batchId: string;
  postType: MediaType;
  scheduledPostId?: string;
  createdVia: CreatedVia;
}

type FacebookPassthrough = {
  config: FacebookDirectPostConfig;
};

/**
 * Publish one post to one Facebook Page via the shared direct-post
 * pipeline. The account row stores the PAGE id as account_identifier and
 * the non-expiring PAGE token as access_token, so ensureValidToken passes
 * it straight through (token_expires_at is null for Facebook).
 *
 * Only called from the Inngest workers (post.now and post.due), which
 * already rate limit at the batch layer, so no per-account checkRateLimit
 * hook here.
 */
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
          return {
            success: false,
            count: 0,
            message: "No Facebook Page id found for account",
          };
        }
        if (
          passthrough.config.postType !== "text" &&
          !passthrough.config.mediaUrl
        ) {
          return {
            success: false,
            count: 0,
            message: "Media URL is required for Facebook image and video posts",
          };
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
