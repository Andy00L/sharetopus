"use server";
import { getSupabaseVideoFile } from "@/actions/server/data/getSupabaseVideoFile";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { postToLinkedIn } from "@/lib/api/linkedin/post/postToLinkedIn";
import type { LinkedInPostResult } from "@/lib/api/linkedin/post/postToLinkedIn";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import {
  directPostForAccountsGeneric,
  type DirectPostScheduleResult,
} from "@/lib/api/_shared/directPostForAccountsGeneric";

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
  cleanupFiles?: boolean;
  fileName?: string;
  batchId: string;
  postType: "image" | "video" | "text";
  isCronJob?: boolean;
  scheduledPostId?: string;
  cronSecret?: string;
  createdVia: "web" | "mcp" | "x402" | "api";
}

type LinkedInPassthrough = {
  buffer?: Buffer;
  memberUrn: string | null;
  config: DirectPostConfig;
};

export async function directPostForLinkedInAccounts(
  config: DirectPostConfig
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
      validate: (pt) => {
        if (!pt.memberUrn) {
          return {
            success: false,
            count: 0,
            message: "No LinkedIn identifier found for account",
          };
        }
        return null;
      },
      checkRateLimit: async (pt) => {
        if (pt.config.isCronJob) return null;
        const rateCheck = await checkRateLimit(
          "directPostLinkedIn",
          pt.config.userId,
          25,
          60
        );
        if (!rateCheck.success) {
          console.warn(
            `[LinkedIn Direct Post] Rate limit exceeded for user: ${pt.config.userId}`
          );
          return {
            success: false,
            count: 0,
            message: "Too many posts. Please try again later.",
          };
        }
        return null;
      },
      preparePassthrough: async (pt) => {
        if (!pt.config.mediaPath) {
          return { success: true, passthrough: pt };
        }
        const buf = await getSupabaseVideoFile(
          pt.config.mediaPath,
          pt.config.userId
        );
        if (!buf.success) {
          console.error(
            `[LinkedIn Direct Post] Failed to fetch media:`,
            buf.message
          );
          return { success: false, count: 0, message: buf.message };
        }
        return { success: true, passthrough: { ...pt, buffer: buf.buffer } };
      },
      call: async (accessToken, pt) =>
        postToLinkedIn({
          accessToken,
          memberUrn: pt.memberUrn!,
          text: pt.config.accountContent.description,
          link: pt.config.accountContent.link,
          mediaPath: pt.config.mediaPath,
          mediaType: pt.config.mediaType,
          fileName: pt.config.fileName,
          userId: pt.config.userId ?? "",
          postType: pt.config.postType,
          buffer: pt.buffer,
          coverTimestamp: pt.config.coverTimestamp,
        }),
      toHistoryFields: (postResult, _pt, cfg) => ({
        content_id: postResult.postId ?? "",
        media_url: postResult.postId
          ? `https://www.linkedin.com/feed/update/${postResult.postId}`
          : null,
        status: "posted",
        extra: {
          post_data: postResult.data,
          post_type: cfg.postType,
          posted_at: new Date().toISOString(),
        },
      }),
    }
  );
}
