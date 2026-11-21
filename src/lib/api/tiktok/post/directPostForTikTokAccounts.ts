import "server-only";
import { insertPendingTikTokPull } from "@/actions/server/data/pendingTikTokPulls";
import { postToTikTok } from "@/lib/api/tiktok/post/postToTikTok";
import type { TikTokPostResult } from "@/lib/api/tiktok/post/postToTikTok";
import { resolveTikTokPrivacyLevel } from "@/lib/api/tiktok/post/tikTokPrivacy";
import { dispatchTikTokPublishPollEvent } from "@/inngest/functions/tikTokPublishStatusPollHelpers";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import {
  buildDirectPostRefusal,
  directPostForAccountsGeneric,
  type DirectPostScheduleResult,
} from "@/lib/api/_shared/directPostForAccountsGeneric";
import type { MediaType } from "@/db/schema";

interface TikTokDirectPostConfig {
  account: SocialAccount;
  mediaPath: string;
  coverTimestamp: number;
  tiktokMediaUrl: string;
  mediaType: string;
  platformOptions: PlatformOptions;
  accountContent: {
    accountId: string;
    title: string;
    description: string;
    isCustomized: boolean;
  };
  userId: string;
  postType: MediaType;
  fileName: string;
  batchId: string;
  scheduledPostId?: string;
  createdVia: "web" | "mcp" | "x402" | "api";
}

type TikTokPassthrough = {
  config: TikTokDirectPostConfig;
};

/** Posts to one TikTok account now and starts polling TikTok for the publish result. */
export async function directPostForTikTokAccounts(
  config: TikTokDirectPostConfig,
): Promise<DirectPostScheduleResult> {
  return directPostForAccountsGeneric<TikTokPassthrough, TikTokPostResult>(
    {
      platform: "tiktok",
      logPrefix: "[TikTok Direct Post]",
      account: config.account,
      accountContent: config.accountContent,
      userId: config.userId,
      batchId: config.batchId,
      scheduledPostId: config.scheduledPostId ?? null,
      postType: config.postType,
      createdVia: config.createdVia,
    },
    { config },
    {
      validate: (passthrough, genericConfig) => {
        if (!passthrough.config.tiktokMediaUrl) {
          return buildDirectPostRefusal(
            "No media URL was minted for the TikTok post.",
            "invalid_input",
          );
        }
        if (genericConfig.accountContent.accountId !== genericConfig.account.id) {
          console.error(
            `[TikTok Direct Post] No or mismatched content for account ${genericConfig.account.id}`,
          );
          return buildDirectPostRefusal(
            "No content found for account",
            "invalid_input",
          );
        }
        return null;
      },
      call: async (accessToken, passthrough) =>
        postToTikTok({
          accessToken,
          title: passthrough.config.accountContent.title ?? "",
          description: passthrough.config.accountContent.description ?? "",
          tikTokOptions: passthrough.config.platformOptions.tiktok,
          mediaType: passthrough.config.mediaType ?? "",
          media_url: passthrough.config.tiktokMediaUrl,
          coverTimestamp: passthrough.config.coverTimestamp,
          postType: passthrough.config.postType,
        }),
      toHistoryFields: (postResult, passthrough, genericConfig) => ({
        content_id: postResult.publishId,
        media_url: postResult.postUrl || null,
        status: postResult.status,
        extra: {
          post_data: postResult.data,
          post_type: genericConfig.postType,
          posted_at: new Date().toISOString(),
          privacy_level: resolveTikTokPrivacyLevel(passthrough.config.platformOptions.tiktok),
        },
      }),
      onPostSuccess: async ({ postResult, historyResult, config: genericConfig }, passthrough) => {
        const pendingInsert = await insertPendingTikTokPull({
          publish_id: postResult.publishId,
          principal_id: genericConfig.userId,
          social_account_id: genericConfig.accountContent.accountId,
          scheduled_post_id: genericConfig.scheduledPostId,
          content_history_id: historyResult.success
            ? (historyResult.recordId ?? null)
            : null,
          media_storage_path: passthrough.config.mediaPath,
          creator_username: postResult.creator_username,
        });
        if (!pendingInsert.success) {
          console.error(
            "[directPostForTikTokAccounts] Failed to insert pending pull:",
            pendingInsert.message,
          );
          return;
        }
        const dispatchResult = await dispatchTikTokPublishPollEvent({
          publish_id: postResult.publishId,
          content_history_id: historyResult.success
            ? (historyResult.recordId ?? null)
            : null,
          social_account_id: genericConfig.accountContent.accountId,
        });
        if (!dispatchResult.success) {
          console.error(
            "[directPostForTikTokAccounts] Failed to dispatch poll event:",
            dispatchResult.message,
          );
        }
      },
    },
  );
}
