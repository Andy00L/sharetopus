import "server-only";

import { getServerSignedViewUrl } from "@/actions/server/data/getServerSignedViewUrl";
import type { StorageReadFailureReason } from "@/actions/server/data/storageRead";
import type { CreatedVia, MediaType } from "@/db/schema";
import type {
  DirectPostScheduleResult,
  DirectPostWarningKind,
} from "@/lib/api/_shared/directPostForAccountsGeneric";
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
  isAdapterPlatform,
  isSchedulablePlatform,
  platformHotlinksMedia,
  type AdapterPlatform,
} from "@/lib/platforms/capabilities";
import {
  publishViaRegistry,
  type PostOrigin,
  type RegistryPublishOutcome,
} from "@/lib/platforms/providers/publishViaRegistry";
import type { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { deriveMediaMimeType } from "@/lib/utils/deriveMediaMimeType";

import { buildInputRefusal, type PublishFailure } from "./platformErrors";

export const DEFAULT_COVER_TIMESTAMP_MS = 1_000;
export const DEFAULT_PINTEREST_BOARD_NAME = "Board";
export const HOTLINK_SIGNED_URL_TTL_S = 30 * 24 * 60 * 60;

type MediaUrlKind = "public_url" | "tiktok_pull_url" | "none";

const MEDIA_URL_KIND_BY_PLATFORM: Record<AdapterPlatform, MediaUrlKind> = {
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
  | { success: false; reason: StorageReadFailureReason; message: string };

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
  const urlKind = isAdapterPlatform(input.platform)
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
      if (!tikTokUrl.success) {
        return { success: false, reason: "unavailable", message: tikTokUrl.message };
      }
      return { success: true, publicUrl: null, tiktokUrl: tikTokUrl.url };
    }
    case "public_url": {
      const signed = await getServerSignedViewUrl(
        input.storagePath,
        resolveSignedUrlTtlS(input.platform),
      );
      if (!signed.success) {
        return { success: false, reason: signed.reason, message: signed.message };
      }
      return { success: true, publicUrl: signed.url, tiktokUrl: null };
    }
    default: {
      const unhandledKind: never = urlKind;
      return {
        success: false,
        reason: "unavailable",
        message: `Unhandled media URL kind: ${String(unhandledKind)}`,
      };
    }
  }
}

// TikTok downloads PULL_FROM_URL media after the publish call returns:
// https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
export function shouldDeleteMediaAfterPublish(input: {
  platform: string;
  mightBeLive: boolean;
}): boolean {
  if (!input.mightBeLive) return true;
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
  origin: PostOrigin;
  createdVia: CreatedVia;
};

export type PublishResult = { ok: true } | PublishFailure;

type PublishWarning = {
  kind: DirectPostWarningKind | "rotated_token_not_saved";
  message: string;
};

function describePostOrigin(origin: PostOrigin): string {
  return origin.kind === "scheduled"
    ? `scheduled_post_id=${origin.scheduledPostId}`
    : `dispatch_id=${origin.dispatchId}`;
}

function logPublishWarnings(request: PublishRequest, warnings: PublishWarning[]): void {
  for (const warning of warnings) {
    console.error(
      `[publishToPlatform] Published with warning kind=${warning.kind} ` +
        `platform=${request.platform} account=${request.account.id} batch_id=${request.batchId} ` +
        `${describePostOrigin(request.origin)}: ${warning.message}`,
    );
  }
}

function fromAdapterResult(
  request: PublishRequest,
  adapterResult: DirectPostScheduleResult,
): PublishResult {
  if (adapterResult.success) {
    logPublishWarnings(request, adapterResult.warnings);
    return { ok: true };
  }
  return {
    ok: false,
    reason: adapterResult.failure.reason,
    message: adapterResult.message,
    mayHavePublished: adapterResult.failure.mayHavePublished,
  };
}

function fromRegistryOutcome(
  request: PublishRequest,
  registryOutcome: RegistryPublishOutcome,
): PublishResult {
  if (registryOutcome.success) {
    if (registryOutcome.reconnectWarning !== null) {
      logPublishWarnings(request, [
        { kind: "rotated_token_not_saved", message: registryOutcome.reconnectWarning },
      ]);
    }
    return { ok: true };
  }
  return {
    ok: false,
    reason: registryOutcome.failure.reason,
    message: registryOutcome.message,
    mayHavePublished: registryOutcome.failure.mayHavePublished,
  };
}

export async function publishToPlatform(request: PublishRequest): Promise<PublishResult> {
  const { account, platform, postType, media } = request;
  if (!isSchedulablePlatform(platform)) {
    return buildInputRefusal(`Unsupported platform: ${platform}`);
  }

  const fileName = media.storagePath.split("/").pop() ?? "";
  const mimeType = deriveMediaMimeType(fileName, postType);
  const coverTimestamp = request.coverTimestampMs ?? DEFAULT_COVER_TIMESTAMP_MS;
  const scheduledPostId =
    request.origin.kind === "scheduled" ? request.origin.scheduledPostId : undefined;
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
          request,
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
            mediaUrl: media.urls.publicUrl,
          }),
        );
      }
      case "linkedin":
        return fromAdapterResult(
          request,
          await directPostForLinkedInAccounts({
            ...sharedConfig,
            mediaType: mimeType,
            platformOptions: request.platformOptions,
            accountContent,
          }),
        );
      case "tiktok":
        return fromAdapterResult(
          request,
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
          request,
          await directPostForInstagramAccounts({
            ...sharedConfig,
            postType,
            coverTimestamp,
            accountContent,
            mediaUrl: media.urls.publicUrl,
          }),
        );
      }
      case "youtube":
        return fromAdapterResult(
          request,
          await directPostForYouTubeAccounts({
            ...sharedConfig,
            mediaType: mimeType,
            platformOptions: request.platformOptions,
            accountContent,
          }),
        );
      case "x":
        return fromAdapterResult(
          request,
          await directPostForXAccounts({
            ...sharedConfig,
            mediaType: mimeType,
            accountContent,
          }),
        );
      case "facebook":
        return fromAdapterResult(
          request,
          await directPostForFacebookAccounts({
            ...sharedConfig,
            accountContent,
            mediaUrl: media.urls.publicUrl,
          }),
        );
      default:
        return fromRegistryOutcome(
          request,
          await publishViaRegistry({
            account,
            principalId: request.principalId,
            title: request.title || null,
            body: request.description || null,
            postType,
            origin: request.origin,
            mediaUrl: media.urls.publicUrl,
            fileName,
            mediaMimeType: mimeType,
            options: request.registryOptions,
            batchId: request.batchId,
            createdVia: request.createdVia,
          }),
        );
    }
  } catch (unexpectedError) {
    const message =
      unexpectedError instanceof Error ? unexpectedError.message : String(unexpectedError);
    console.error(`[publishToPlatform] ${platform} adapter threw:`, message);
    return { ok: false, reason: "unknown", message, mayHavePublished: true };
  }
}
