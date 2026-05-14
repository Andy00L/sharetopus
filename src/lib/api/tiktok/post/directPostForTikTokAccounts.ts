import "server-only";
import { insertPendingTikTokPull } from "@/actions/server/data/pendingTikTokPulls";
import { postToTikTok } from "@/lib/api/tiktok/post/postToTikTok";
import type { TikTokPostResult } from "@/lib/api/tiktok/post/postToTikTok";
import { dispatchTikTokPublishPollEvent } from "@/inngest/functions/tikTokPublishStatusPollHelpers";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import {
  directPostForAccountsGeneric,
  type DirectPostScheduleResult,
} from "@/lib/api/_shared/directPostForAccountsGeneric";
import { MediaType } from "@/lib/types/database.types";

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
      validate: (pt, cfg) => {
        if (!pt.config.tiktokMediaUrl) {
          return {
            success: false,
            count: 0,
            message: "Content file could not be retrieve.",
          };
        }
        if (cfg.accountContent.accountId !== cfg.account.id) {
          console.error(
            `[TikTok Direct Post] No or mismatched content for account ${cfg.account.id}`,
          );
          return {
            success: false,
            count: 0,
            message: "No content found for account",
          };
        }
        return null;
      },
      call: async (accessToken, pt) =>
        postToTikTok({
          accessToken,
          title: pt.config.accountContent.title ?? "",
          description: pt.config.accountContent.description ?? "",
          tikTokOptions: pt.config.platformOptions.tiktok,
          mediaType: pt.config.mediaType ?? "",
          media_url: pt.config.tiktokMediaUrl,
          coverTimestamp: pt.config.coverTimestamp,
          postType: pt.config.postType,
        }),
      toHistoryFields: (postResult, pt, cfg) => ({
        content_id: postResult.postId || postResult.publishId || "",
        media_url: postResult.postUrl || null,
        status: postResult.status ?? "posted",
        extra: {
          post_data: postResult.data,
          post_type: cfg.postType,
          posted_at: new Date().toISOString(),
          privacy_level: pt.config.platformOptions.tiktok,
        },
      }),
      onPostSuccess: async ({ postResult, historyResult, config: cfg }, pt) => {
        if (!postResult.publishId) return;
        const pendingInsert = await insertPendingTikTokPull({
          publish_id: postResult.publishId,
          principal_id: cfg.userId,
          social_account_id: cfg.accountContent.accountId,
          scheduled_post_id: cfg.scheduledPostId,
          content_history_id: historyResult.success
            ? (historyResult.recordId ?? null)
            : null,
          media_storage_path: pt.config.mediaPath,
          creator_username: null, // Populated in commit 3 via TikTokPostResult.creator_username
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
          social_account_id: cfg.accountContent.accountId,
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
