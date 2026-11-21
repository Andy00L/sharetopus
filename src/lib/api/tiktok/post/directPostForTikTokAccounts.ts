import "server-only";
import { insertPendingTikTokPull } from "@/actions/server/data/pendingTikTokPulls";
import { inngest } from "@/inngest/client";
import { postToTikTok } from "@/lib/api/tiktok/post/postToTikTok";
import type { TikTokPostResult } from "@/lib/api/tiktok/post/postToTikTok";
import { resolveTikTokPrivacyLevel } from "@/lib/api/tiktok/post/tikTokPrivacy";
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

/**
 * Starts the publish-status poll for one TikTok post. Inngest drops a
 * repeated event id for 24 hours, so a second send for the same publish_id
 * starts no second poller: https://www.inngest.com/docs/guides/handling-idempotency
 */
async function sendTikTokPublishPollEvent(input: {
  publishId: string;
  contentHistoryId: string | null;
  socialAccountId: string;
}): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await inngest.send({
      id: `tiktok-poll-${input.publishId}`,
      name: "tiktok.publish.poll",
      data: {
        publish_id: input.publishId,
        content_history_id: input.contentHistoryId,
        social_account_id: input.socialAccountId,
      },
    });
    return { success: true };
  } catch (sendError) {
    return {
      success: false,
      message: sendError instanceof Error ? sendError.message : String(sendError),
    };
  }
}

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
        const contentHistoryId = historyResult.success
          ? (historyResult.recordId ?? null)
          : null;
        const pendingInsert = await insertPendingTikTokPull({
          publish_id: postResult.publishId,
          principal_id: genericConfig.userId,
          social_account_id: genericConfig.accountContent.accountId,
          scheduled_post_id: genericConfig.scheduledPostId,
          content_history_id: contentHistoryId,
          media_storage_path: passthrough.config.mediaPath,
          creator_username: postResult.creator_username,
        });
        if (!pendingInsert.success) {
          console.error(
            `[directPostForTikTokAccounts] No pending pull for live publish_id ${postResult.publishId}, so no poll starts:`,
            pendingInsert.message,
          );
          return [{ kind: "tiktok_pull_not_recorded", message: pendingInsert.message }];
        }
        const pollSend = await sendTikTokPublishPollEvent({
          publishId: postResult.publishId,
          contentHistoryId,
          socialAccountId: genericConfig.accountContent.accountId,
        });
        if (!pollSend.success) {
          console.error(
            `[directPostForTikTokAccounts] Poll event not sent for publish_id ${postResult.publishId}:`,
            pollSend.message,
          );
          return [{ kind: "tiktok_poll_not_sent", message: pollSend.message }];
        }
        return [];
      },
    },
  );
}
