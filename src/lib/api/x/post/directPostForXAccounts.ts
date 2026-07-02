import "server-only";

import { getSupabaseVideoFile } from "@/actions/server/data/getSupabaseVideoFile";
import {
  directPostForAccountsGeneric,
  type DirectPostScheduleResult,
} from "@/lib/api/_shared/directPostForAccountsGeneric";
import { postToX } from "@/lib/api/x/post/postToX";
import type { XPostResult } from "@/lib/api/x/post/postToX";
import type { CreatedVia, MediaType } from "@/lib/types/database.types";
import type { SocialAccount } from "@/lib/types/dbTypes";

interface XDirectPostConfig {
  account: SocialAccount;
  mediaPath: string;
  mediaType?: string;
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

type XPassthrough = {
  buffer?: Buffer;
  config: XDirectPostConfig;
};

/**
 * Publish one tweet for one X account via the shared direct-post pipeline.
 * Text posts skip media entirely; image/video posts fetch the file from
 * storage and hand the buffer to the chunked upload in postToX.
 *
 * Only called from the Inngest workers (post.now and post.due), which
 * already rate limit at the batch layer, so no per-account checkRateLimit
 * hook here.
 */
export async function directPostForXAccounts(
  config: XDirectPostConfig,
): Promise<DirectPostScheduleResult> {
  return directPostForAccountsGeneric<XPassthrough, XPostResult>(
    {
      platform: "x",
      logPrefix: "[X Direct Post]",
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
        if (
          passthrough.config.postType !== "text" &&
          !passthrough.config.mediaPath
        ) {
          return {
            success: false,
            count: 0,
            message: "Media file is required for X image and video posts",
          };
        }
        return null;
      },
      preparePassthrough: async (passthrough) => {
        if (
          passthrough.config.postType === "text" ||
          !passthrough.config.mediaPath
        ) {
          return { success: true, passthrough };
        }
        const fileResult = await getSupabaseVideoFile(
          passthrough.config.mediaPath,
          passthrough.config.userId,
        );
        if (!fileResult.success) {
          console.error(
            "[X Direct Post] Failed to fetch media:",
            fileResult.message,
          );
          return { success: false, count: 0, message: fileResult.message };
        }
        return {
          success: true,
          passthrough: { ...passthrough, buffer: fileResult.buffer },
        };
      },
      call: async (accessToken, passthrough) =>
        postToX({
          accessToken,
          text: passthrough.config.accountContent.description,
          buffer: passthrough.buffer,
          mediaType: passthrough.config.mediaType,
          postType: passthrough.config.postType,
          username: passthrough.config.account.username ?? undefined,
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
