import "server-only";

import { getSupabaseVideoFile } from "@/actions/server/data/getSupabaseVideoFile";
import { toPublishFailureReason } from "@/actions/server/data/storageRead";
import {
  buildDirectPostRefusal,
  directPostForAccountsGeneric,
  type DirectPostScheduleResult,
} from "@/lib/api/_shared/directPostForAccountsGeneric";
import {
  postToYouTube,
  YOUTUBE_TITLE_MAX_CHARS,
} from "@/lib/api/youtube/post/postToYouTube";
import type { YouTubePostResult } from "@/lib/api/youtube/post/postToYouTube";
import type { CreatedVia, MediaType } from "@/db/schema";
import type { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";

interface YouTubeDirectPostConfig {
  account: SocialAccount;
  mediaPath: string;
  mediaType?: string;
  platformOptions: PlatformOptions;
  accountContent: {
    accountId: string;
    title?: string;
    description: string;
  };
  userId: string | null;
  batchId: string;
  postType: MediaType;
  scheduledPostId?: string;
  createdVia: CreatedVia;
}

type YouTubePassthrough = {
  buffer?: Buffer;
  config: YouTubeDirectPostConfig;
};

/**
 * Publish one video to one YouTube channel via the shared direct-post
 * pipeline. Only called from the Inngest workers (post.now and post.due),
 * which already rate limit at the batch layer, so no per-account
 * checkRateLimit hook here.
 *
 * YouTube accepts video only; the platform compatibility check rejects
 * text/image upstream and validate() backstops it.
 */
export async function directPostForYouTubeAccounts(
  config: YouTubeDirectPostConfig,
): Promise<DirectPostScheduleResult> {
  return directPostForAccountsGeneric<YouTubePassthrough, YouTubePostResult>(
    {
      platform: "youtube",
      logPrefix: "[YouTube Direct Post]",
      account: config.account,
      accountContent: config.accountContent,
      userId: config.userId ?? "",
      batchId: config.batchId,
      scheduledPostId: config.scheduledPostId ?? null,
      postType: config.postType,
      createdVia: config.createdVia,
    },
    { buffer: undefined, config },
    {
      validate: (passthrough) => {
        if (passthrough.config.postType !== "video") {
          return buildDirectPostRefusal(
            "YouTube only supports video posts",
            "invalid_input",
          );
        }
        if (!passthrough.config.mediaPath) {
          return buildDirectPostRefusal(
            "Media file is required for YouTube posts",
            "invalid_input",
          );
        }
        return null;
      },
      preparePassthrough: async (passthrough) => {
        const fileResult = await getSupabaseVideoFile(
          passthrough.config.mediaPath,
          passthrough.config.userId,
        );
        if (!fileResult.success) {
          console.error(
            "[YouTube Direct Post] Failed to fetch media:",
            fileResult.message,
          );
          return buildDirectPostRefusal(fileResult.message, toPublishFailureReason(fileResult.reason));
        }
        return {
          success: true,
          passthrough: { ...passthrough, buffer: fileResult.buffer },
        };
      },
      call: async (accessToken, passthrough) => {
        const content = passthrough.config.accountContent;
        // YouTube requires a non-empty title; fall back to the caption head.
        const resolvedTitle =
          content.title?.trim() ||
          content.description.trim().slice(0, YOUTUBE_TITLE_MAX_CHARS) ||
          "Untitled video";

        return postToYouTube({
          accessToken,
          title: resolvedTitle,
          description: content.description,
          buffer: passthrough.buffer ?? Buffer.alloc(0),
          mediaType: passthrough.config.mediaType ?? "video/mp4",
          privacyStatus:
            passthrough.config.platformOptions.youtube?.privacyStatus ??
            "public",
        });
      },
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
