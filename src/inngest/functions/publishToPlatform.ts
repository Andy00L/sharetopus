import "server-only";

import { getServerSignedViewUrl } from "@/actions/server/data/getServerSignedViewUrl";
import type { CreatedVia, MediaType, Platform } from "@/db/schema";
import type { DirectPostScheduleResult } from "@/lib/api/_shared/directPostForAccountsGeneric";
import { directPostForFacebookAccounts } from "@/lib/api/facebook/post/directPostForFacebookAccounts";
import { directPostForInstagramAccounts } from "@/lib/api/instagram/post/directPostForInstagramAccounts";
import { directPostForLinkedInAccounts } from "@/lib/api/linkedin/post/directPostForLinkedInAccounts";
import { directPostForPinterestAccounts } from "@/lib/api/pinterest/post/directPostForPinterestAccounts";
import { buildTikTokMediaUrl } from "@/lib/api/tiktok/buildTikTokMediaUrl";
import { directPostForTikTokAccounts } from "@/lib/api/tiktok/post/directPostForTikTokAccounts";
import { directPostForXAccounts } from "@/lib/api/x/post/directPostForXAccounts";
import { directPostForYouTubeAccounts } from "@/lib/api/youtube/post/directPostForYouTubeAccounts";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";
import {
  isPostingPlatform,
  isSchedulablePlatform,
  platformHotlinksMedia,
  type PostingPlatform,
} from "@/lib/platforms/capabilities";
import {
  publishViaRegistry,
  type RegistryPublishResult,
} from "@/lib/platforms/providers/publishViaRegistry";
import type { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { deriveMediaMimeType } from "@/lib/utils/deriveMediaMimeType";

import {
  buildInputRefusal,
  buildTextClassifiedFailure,
  type PublishFailure,
} from "./platformErrors";

export const DEFAULT_COVER_TIMESTAMP_MS = 1_000;
export const DEFAULT_PINTEREST_BOARD_NAME = "Board";
export const HOTLINK_SIGNED_URL_TTL_S = 30 * 24 * 60 * 60;

type MediaUrlKind = "public_url" | "tiktok_pull_url" | "none";

const MEDIA_URL_KIND_BY_PLATFORM: Record<PostingPlatform, MediaUrlKind> = {
  pinterest: "public_url",
  instagram: "public_url",
  facebook: "public_url",
  tiktok: "tiktok_pull_url",
  linkedin: "none",
  youtube: "none",
  x: "none",
};

export type PublishMediaUrls = {
  publicUrl: string | null;
  tiktokUrl: string | null;
};

export type MintMediaUrlsResult =
  | ({ success: true } & PublishMediaUrls)
  | { success: false; message: string };

export function resolveSignedUrlTtlS(platform: string): number {
  return platformHotlinksMedia(platform) ? HOTLINK_SIGNED_URL_TTL_S : RUNTIME.signedUrlTtlS;
}

export async function mintPublishMediaUrls(input: {
  platform: string;
  storagePath: string;
  principalId: string;
}): Promise<MintMediaUrlsResult> {
  if (input.storagePath === "") {
    return { success: true, publicUrl: null, tiktokUrl: null };
  }
  const urlKind = isPostingPlatform(input.platform)
    ? MEDIA_URL_KIND_BY_PLATFORM[input.platform]
    : "public_url";

  switch (urlKind) {
    case "none":
      return { success: true, publicUrl: null, tiktokUrl: null };
    case "tiktok_pull_url": {
      const tikTokUrl = await buildTikTokMediaUrl({
        mediaPath: input.storagePath,
        principalId: input.principalId,
      });
      if (!tikTokUrl.success) return { success: false, message: tikTokUrl.message };
      return { success: true, publicUrl: null, tiktokUrl: tikTokUrl.url };
    }
    case "public_url": {
      const signed = await getServerSignedViewUrl(
        input.storagePath,
        resolveSignedUrlTtlS(input.platform),
      );
      if (!signed.success) return { success: false, message: signed.message };
      return { success: true, publicUrl: signed.url, tiktokUrl: null };
    }
    default: {
      const unhandledKind: never = urlKind;
      return { success: false, message: `Unhandled media URL kind: ${String(unhandledKind)}` };
    }
  }
}

// TikTok downloads PULL_FROM_URL media after the publish call returns:
// https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
export function shouldDeleteMediaAfterPublish(input: {
  platform: string;
  isPublished: boolean;
}): boolean {
  if (!input.isPublished) return true;
  return input.platform !== "tiktok" && !platformHotlinksMedia(input.platform);
}

export type PublishRequest = {
  account: SocialAccount;
  principalId: string;
  platform: string;
  postType: MediaType;
  title: string;
  description: string;
  link: string;
  platformOptions: PlatformOptions;
  pinterestBoard: { boardId: string; boardName: string | null } | null;
  registryOptions: unknown;
  coverTimestampMs: number | null;
  media: { storagePath: string; urls: PublishMediaUrls };
  batchId: string;
  scheduledPostId: string | null;
  createdVia: CreatedVia;
};

export type PublishResult = { ok: true } | PublishFailure;

function fromAdapterResult(adapterResult: DirectPostScheduleResult): PublishResult {
  if (adapterResult.success) return { ok: true };
  return {
    ok: false,
    reason: adapterResult.failure.reason,
    message: adapterResult.message,
    mayHavePublished: adapterResult.failure.mayHavePublished,
  };
}

function fromRegistryResult(
  platform: Platform,
  registryResult: RegistryPublishResult,
): PublishResult {
  if (registryResult.success && registryResult.count > 0) return { ok: true };
  return buildTextClassifiedFailure(platform, registryResult.message ?? "Failed without message");
}

export async function publishToPlatform(request: PublishRequest): Promise<PublishResult> {
  const { account, platform, postType, media } = request;
  if (!isSchedulablePlatform(platform)) {
    return buildInputRefusal(`Unsupported platform: ${platform}`);
  }

  const fileName = media.storagePath.split("/").pop() ?? "";
  const mimeType = deriveMediaMimeType(fileName, postType);
  const coverTimestamp = request.coverTimestampMs ?? DEFAULT_COVER_TIMESTAMP_MS;
  const scheduledPostId = request.scheduledPostId ?? undefined;
  const accountContent = {
    accountId: account.id,
    title: request.title,
    description: request.description,
    link: request.link,
    isCustomized: true,
  };
  const sharedConfig = {
    account,
    mediaPath: media.storagePath,
    userId: request.principalId,
    batchId: request.batchId,
    postType,
    scheduledPostId,
    createdVia: request.createdVia,
  };

  try {
    switch (platform) {
      case "pinterest": {
        const board = request.pinterestBoard;
        if (!board?.boardId) {
          return buildInputRefusal("No board configured for Pinterest post");
        }
        return fromAdapterResult(
          await directPostForPinterestAccounts({
            ...sharedConfig,
            coverTimestamp,
            boards: {
              boardID: board.boardId,
              boardName: board.boardName ?? DEFAULT_PINTEREST_BOARD_NAME,
              accountId: account.id,
              isSelected: true,
            },
            platformOptions: request.platformOptions,
            accountContent,
            fileName,
            mediaType: mimeType,
            mediaUrl: media.urls.publicUrl ?? "",
          }),
        );
      }
      case "linkedin":
        return fromAdapterResult(
          await directPostForLinkedInAccounts({
            ...sharedConfig,
            mediaType: mimeType,
            platformOptions: request.platformOptions,
            accountContent,
          }),
        );
      case "tiktok":
        return fromAdapterResult(
          await directPostForTikTokAccounts({
            ...sharedConfig,
            coverTimestamp,
            tiktokMediaUrl: media.urls.tiktokUrl ?? "",
            mediaType: mimeType,
            platformOptions: request.platformOptions,
            accountContent,
            fileName,
          }),
        );
      case "instagram": {
        if (postType === "text") {
          return buildInputRefusal("Instagram does not support text posts");
        }
        return fromAdapterResult(
          await directPostForInstagramAccounts({
            ...sharedConfig,
            postType,
            coverTimestamp,
            mediaType: mimeType,
            accountContent,
            mediaUrl: media.urls.publicUrl ?? "",
            fileName,
          }),
        );
      }
      case "youtube":
        return fromAdapterResult(
          await directPostForYouTubeAccounts({
            ...sharedConfig,
            mediaType: mimeType,
            platformOptions: request.platformOptions,
            accountContent,
          }),
        );
      case "x":
        return fromAdapterResult(
          await directPostForXAccounts({
            ...sharedConfig,
            mediaType: mimeType,
            accountContent,
          }),
        );
      case "facebook":
        return fromAdapterResult(
          await directPostForFacebookAccounts({
            ...sharedConfig,
            accountContent,
            mediaUrl: media.urls.publicUrl ?? "",
          }),
        );
      default:
        return fromRegistryResult(
          platform,
          await publishViaRegistry({
            account,
            principalId: request.principalId,
            title: request.title || null,
            body: request.description || null,
            mediaType: postType,
            mediaUrl: media.urls.publicUrl,
            fileName,
            mediaMimeType: mimeType,
            options: request.registryOptions,
            batchId: request.batchId,
            scheduledPostId: request.scheduledPostId,
            createdVia: request.createdVia,
          }),
        );
    }
  } catch (unexpectedError) {
    const message =
      unexpectedError instanceof Error ? unexpectedError.message : String(unexpectedError);
    console.error(`[publishToPlatform] ${platform} adapter threw:`, message);
    return buildTextClassifiedFailure(platform, message);
  }
}
