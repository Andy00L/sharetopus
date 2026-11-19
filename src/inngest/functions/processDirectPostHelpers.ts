import "server-only";

import { eventType, staticSchema } from "inngest";

import type { MediaType, Platform } from "@/db/schema";
import { directPostForFacebookAccounts } from "@/lib/api/facebook/post/directPostForFacebookAccounts";
import { directPostForInstagramAccounts } from "@/lib/api/instagram/post/directPostForInstagramAccounts";
import { directPostForLinkedInAccounts } from "@/lib/api/linkedin/post/directPostForLinkedInAccounts";
import { directPostForPinterestAccounts } from "@/lib/api/pinterest/post/directPostForPinterestAccounts";
import { directPostForTikTokAccounts } from "@/lib/api/tiktok/post/directPostForTikTokAccounts";
import { directPostForXAccounts } from "@/lib/api/x/post/directPostForXAccounts";
import { directPostForYouTubeAccounts } from "@/lib/api/youtube/post/directPostForYouTubeAccounts";
import { getServerSignedViewUrl } from "@/actions/server/data/getServerSignedViewUrl";
import { platformHotlinksMedia } from "@/lib/platforms/capabilities";
import { publishViaRegistry } from "@/lib/platforms/providers/publishViaRegistry";
import {
  HOTLINK_SIGNED_URL_TTL_S,
} from "@/inngest/functions/processSinglePostHelpers";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";
import type { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";

export type PostNowEventData = {
  batch_id: string;
  principal_id: string;
  social_account_id: string;
  platform: Platform;
  post_type: MediaType;
  account_content: {
    accountId: string;
    title: string;
    description: string;
    link: string;
    isCustomized: boolean;
  };
  platform_options: PlatformOptions;
  board: {
    boardID: string;
    boardName: string;
    accountId: string;
    isSelected: boolean;
  } | null;
  cover_timestamp: number;
  file_name: string;
  media_type: string;
  media_path: string;
  media_url: string | null;
  tiktok_media_url: string | null;
  dispatch_id?: string;
  created_via?: "web" | "mcp" | "x402" | "api";
  idempotency_key?: string;
  request_id?: string | null;
  post_options?: Record<string, unknown> | null;
};

export const postNowEvent = eventType("post.now", {
  schema: staticSchema<PostNowEventData>(),
});

export type DirectPostResult = {
  success: boolean;
  message: string | null;
  contentId: string | null;
};

export async function callDirectPostFromEvent(
  data: PostNowEventData,
  account: SocialAccount,
): Promise<DirectPostResult> {
  const {
    platform,
    post_type,
    account_content,
    platform_options,
    board,
    cover_timestamp,
    file_name,
    media_type,
    media_path,
    media_url,
    tiktok_media_url,
    batch_id,
    created_via,
  } = data;

  const createdVia = created_via ?? "web";

  try {
    let result: { success: boolean; count: number; message?: string };

    switch (platform) {
      case "pinterest": {
        if (!board) {
          return {
            success: false,
            message: "No board configured for Pinterest post",
            contentId: null,
          };
        }
        result = await directPostForPinterestAccounts({
          account,
          mediaPath: media_path,
          coverTimestamp: cover_timestamp,
          boards: board,
          platformOptions: platform_options,
          accountContent: account_content,
          userId: data.principal_id,
          fileName: file_name,
          batchId: batch_id,
          mediaType: media_type,
          postType: post_type,
          mediaUrl: media_url ?? "",
          createdVia,
        });
        break;
      }
      case "linkedin": {
        result = await directPostForLinkedInAccounts({
          account,
          mediaPath: media_path,
          coverTimestamp: cover_timestamp,
          mediaType: media_type,
          platformOptions: platform_options,
          accountContent: account_content,
          userId: data.principal_id,
          fileName: file_name,
          batchId: batch_id,
          postType: post_type,
          isCronJob: true,
          createdVia,
        });
        break;
      }
      case "tiktok": {
        result = await directPostForTikTokAccounts({
          account,
          mediaPath: media_path,
          coverTimestamp: cover_timestamp,
          tiktokMediaUrl: tiktok_media_url ?? "",
          mediaType: media_type,
          platformOptions: platform_options,
          accountContent: account_content,
          userId: data.principal_id,
          postType: post_type,
          fileName: file_name,
          batchId: batch_id,
          createdVia,
        });
        break;
      }
      case "instagram": {
        if (post_type === "text") {
          return {
            success: false,
            message: "Instagram does not support text posts",
            contentId: null,
          };
        }
        result = await directPostForInstagramAccounts({
          account,
          mediaPath: media_path,
          coverTimestamp: cover_timestamp,
          mediaType: media_type,
          accountContent: account_content,
          userId: data.principal_id,
          mediaUrl: media_url ?? "",
          postType: post_type,
          fileName: file_name,
          batchId: batch_id,
          createdVia,
        });
        break;
      }
      case "youtube": {
        result = await directPostForYouTubeAccounts({
          account,
          mediaPath: media_path,
          mediaType: media_type,
          platformOptions: platform_options,
          accountContent: account_content,
          userId: data.principal_id,
          batchId: batch_id,
          postType: post_type,
          createdVia,
        });
        break;
      }
      case "x": {
        result = await directPostForXAccounts({
          account,
          mediaPath: media_path,
          mediaType: media_type,
          accountContent: account_content,
          userId: data.principal_id,
          batchId: batch_id,
          postType: post_type,
          createdVia,
        });
        break;
      }
      case "facebook": {
        result = await directPostForFacebookAccounts({
          account,
          mediaPath: media_path,
          accountContent: account_content,
          userId: data.principal_id,
          mediaUrl: media_url ?? "",
          batchId: batch_id,
          postType: post_type,
          createdVia,
        });
        break;
      }
      default: {
        let registryMediaUrl: string | null = media_url ?? null;
        if (media_path && media_path !== "") {
          const signed = await getServerSignedViewUrl(
            media_path,
            platformHotlinksMedia(platform)
              ? HOTLINK_SIGNED_URL_TTL_S
              : RUNTIME.signedUrlTtlS,
          );
          if (!signed.success) {
            return {
              success: false,
              message: signed.message ?? "Failed to mint signed URL",
              contentId: null,
            };
          }
          registryMediaUrl = signed.url ?? null;
        }

        const registryResult = await publishViaRegistry({
          account,
          principalId: data.principal_id,
          title: account_content.title || null,
          body: account_content.description || null,
          mediaType: post_type,
          mediaUrl: registryMediaUrl,
          fileName: file_name,
          mediaMimeType: media_type,
          options: data.post_options ?? {},
          batchId: batch_id,
          scheduledPostId: null,
          createdVia,
        });
        return {
          success: registryResult.success,
          message: registryResult.message ?? null,
          contentId: registryResult.success ? batch_id : null,
        };
      }
    }

    if (result.success && result.count > 0) {
      return {
        success: true,
        message: result.message ?? null,
        contentId: batch_id,
      };
    }

    return {
      success: false,
      message: result.message ?? "Failed without message",
      contentId: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message, contentId: null };
  }
}
