import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { directPostForFacebookAccounts } from "@/lib/api/facebook/post/directPostForFacebookAccounts";
import { directPostForInstagramAccounts } from "@/lib/api/instagram/post/directPostForInstagramAccounts";
import { directPostForLinkedInAccounts } from "@/lib/api/linkedin/post/directPostForLinkedInAccounts";
import { directPostForPinterestAccounts } from "@/lib/api/pinterest/post/directPostForPinterestAccounts";
import { directPostForTikTokAccounts } from "@/lib/api/tiktok/post/directPostForTikTokAccounts";
import { directPostForXAccounts } from "@/lib/api/x/post/directPostForXAccounts";
import { directPostForYouTubeAccounts } from "@/lib/api/youtube/post/directPostForYouTubeAccounts";
import { MediaType, Platform } from "@/lib/types/database.types";
import type { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";

// ---------- event data type ----------

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
  // Correlation ID propagated from the originating request. Optional because
  // pre-existing scheduled posts may dispatch events without one.
  request_id?: string | null;
};

// ---------- fetch-account ----------

export type FetchAccountResult =
  | { success: true; account: SocialAccount }
  | { success: false; message: string };

export async function fetchAccountForDirectPost(
  socialAccountId: string,
): Promise<FetchAccountResult> {
  const { data: account, error } = await adminSupabase
    .from("social_accounts")
    .select("*")
    .eq("id", socialAccountId)
    .is("deleted_at", null)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return {
        success: false,
        message: "Social account not found or deleted",
      };
    }
    return {
      success: false,
      message: `Failed to fetch account: ${error.message}`,
    };
  }
  if (!account) {
    return {
      success: false,
      message: "Social account not found or deleted",
    };
  }

  return { success: true, account: account as SocialAccount };
}

// ---------- call-platform-direct-post ----------

export type DirectPostResult = {
  success: boolean;
  message: string | null;
  contentId: string | null;
};

/**
 * Adapts the event payload to the directPostFor* function signatures.
 * Each platform function takes slightly different args; this switch
 * normalizes them. Modeled on callPlatformDirectPost in
 * processSinglePostHelpers but reads from event data instead of a
 * ScheduledPost row.
 */
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
          isCronJob: true, // skip rate limiting in worker context
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
        const igPostType = post_type as "image" | "video";
        result = await directPostForInstagramAccounts({
          account,
          mediaPath: media_path,
          coverTimestamp: cover_timestamp,
          mediaType: media_type,
          accountContent: account_content,
          userId: data.principal_id,
          mediaUrl: media_url ?? "",
          postType: igPostType,
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
        return {
          success: false,
          message: `Unsupported platform: ${platform}`,
          contentId: null,
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
