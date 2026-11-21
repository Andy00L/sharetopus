import "server-only";
import { getSupabaseVideoFile } from "@/actions/server/data/getSupabaseVideoFile";
import { postToLinkedIn } from "@/lib/api/linkedin/post/postToLinkedIn";
import type { LinkedInPostResult } from "@/lib/api/linkedin/post/postToLinkedIn";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import {
  buildDirectPostRefusal,
  directPostForAccountsGeneric,
  type DirectPostScheduleResult,
} from "@/lib/api/_shared/directPostForAccountsGeneric";
import type { CreatedVia, MediaType } from "@/db/schema";

interface AccountContent {
  accountId: string;
  title?: string;
  description: string;
  link: string;
  isCustomized: boolean;
}

interface DirectPostConfig {
  account: SocialAccount;
  mediaPath: string;
  coverTimestamp?: number;
  mediaType?: string;
  platformOptions: PlatformOptions;
  accountContent: AccountContent;
  userId: string | null;
  fileName?: string;
  batchId: string;
  postType: MediaType;
  isCronJob?: boolean;
  scheduledPostId?: string;
  createdVia: CreatedVia;
}

type LinkedInPassthrough = {
  buffer?: Buffer;
  memberUrn: string | null;
  config: DirectPostConfig;
};

/**
 * Publish one post to one LinkedIn member via the shared direct-post
 * pipeline. Only called from the Inngest workers (post.now and post.due),
 * which already rate limit at the batch layer.
 */
export async function directPostForLinkedInAccounts(
  config: DirectPostConfig,
): Promise<DirectPostScheduleResult> {
  return directPostForAccountsGeneric<LinkedInPassthrough, LinkedInPostResult>(
    {
      platform: "linkedin",
      logPrefix: "[LinkedIn Direct Post]",
      account: config.account,
      accountContent: config.accountContent,
      userId: config.userId ?? "",
      batchId: config.batchId,
      scheduledPostId: config.scheduledPostId ?? null,
      postType: config.postType,
      createdVia: config.createdVia,
    },
    {
      buffer: undefined,
      memberUrn: config.account.account_identifier
        ? `urn:li:person:${config.account.account_identifier}`
        : null,
      config,
    },
    {
      validate: (passthrough) => {
        if (!passthrough.memberUrn) {
          return buildDirectPostRefusal(
            "No LinkedIn identifier found for account",
            "invalid_input",
          );
        }
        return null;
      },
      preparePassthrough: async (passthrough) => {
        if (passthrough.config.postType === "text" || !passthrough.config.mediaPath) {
          return { success: true, passthrough };
        }
        const fileResult = await getSupabaseVideoFile(
          passthrough.config.mediaPath,
          passthrough.config.userId,
        );
        if (!fileResult.success) {
          console.error(
            `[LinkedIn Direct Post] Failed to fetch media:`,
            fileResult.message,
          );
          return buildDirectPostRefusal(fileResult.message, "transient");
        }
        return {
          success: true,
          passthrough: { ...passthrough, buffer: fileResult.buffer },
        };
      },
      call: async (accessToken, passthrough) =>
        postToLinkedIn({
          accessToken,
          memberUrn: passthrough.memberUrn ?? "",
          text: passthrough.config.accountContent.description,
          link: passthrough.config.accountContent.link,
          mediaType: passthrough.config.mediaType,
          postType: passthrough.config.postType,
          buffer: passthrough.buffer,
        }),
      toHistoryFields: (postResult, _passthrough, genericConfig) => ({
        content_id: postResult.postId,
        media_url: postResult.postId
          ? `https://www.linkedin.com/feed/update/${postResult.postId}`
          : null,
        status: "posted",
        extra: {
          post_data: postResult.data,
          post_type: genericConfig.postType,
          posted_at: new Date().toISOString(),
        },
      }),
    },
  );
}
