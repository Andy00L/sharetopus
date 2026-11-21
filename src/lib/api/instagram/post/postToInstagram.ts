import "server-only";

import { z } from "zod";

import {
  buildHttpFailure,
  buildInputFailure,
  buildNetworkFailure,
  buildUnreadableAnswerFailure,
  type PlatformPostFailure,
} from "@/lib/api/_shared/platformFailure";
import { META_GRAPH_API_VERSION } from "@/lib/api/_shared/metaGraphApiVersion";
import {
  PLATFORM_API_TIMEOUT_MS,
  PLATFORM_IMAGE_PULL_TIMEOUT_MS,
  PLATFORM_PUBLISH_TIMEOUT_MS,
} from "@/lib/api/_shared/platformFetchTimeouts";
import { parseJsonObject } from "@/lib/platforms/providers/_shared/providerFetch";

const INSTAGRAM_GRAPH_BASE_URL = `https://graph.instagram.com/${META_GRAPH_API_VERSION}`;

const CONTAINER_POLL_INITIAL_INTERVAL_MS = 3_000;
const CONTAINER_POLL_MAX_INTERVAL_MS = 15_000;
const CONTAINER_READY_DEADLINE_MS = 150_000;

const CreatedObjectSchema = z.object({ id: z.string().min(1) });

// Container status_code values: EXPIRED, ERROR, FINISHED, IN_PROGRESS, PUBLISHED.
// https://developers.facebook.com/docs/instagram-platform/content-publishing
const ContainerStatusSchema = z.object({ status_code: z.string() });

const MediaPermalinkSchema = z.object({ permalink: z.string().optional() });

export type InstagramPostResult =
  | {
      success: true;
      postId: string;
      postUrl?: string;
      containerId: string;
      message: string;
    }
  | PlatformPostFailure;

type ContainerOutcome = { success: true; containerId: string } | PlatformPostFailure;

function buildAuthHeaders(accessToken: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
}

async function createMediaContainer(input: {
  accessToken: string;
  igUserId: string;
  caption: string;
  mediaUrl: string;
  postType: "image" | "reel";
  altText?: string;
  shareToFeed?: boolean;
  coverTimestamp?: number;
}): Promise<ContainerOutcome> {
  const isReel = input.postType === "reel";
  const containerParams = isReel
    ? {
        video_url: input.mediaUrl,
        media_type: "REELS",
        caption: input.caption || undefined,
        share_to_feed: input.shareToFeed,
        thumb_offset: input.coverTimestamp,
      }
    : {
        image_url: input.mediaUrl,
        caption: input.caption || undefined,
        alt_text: input.altText || undefined,
      };

  const action = `Instagram ${input.postType} container creation`;
  try {
    const containerResponse = await fetch(
      `${INSTAGRAM_GRAPH_BASE_URL}/${input.igUserId}/media`,
      {
        method: "POST",
        headers: buildAuthHeaders(input.accessToken),
        body: JSON.stringify(containerParams),
        signal: AbortSignal.timeout(
          isReel ? PLATFORM_API_TIMEOUT_MS : PLATFORM_IMAGE_PULL_TIMEOUT_MS,
        ),
      },
    );
    const containerText = await containerResponse.text();
    if (!containerResponse.ok) {
      console.error(
        `[createMediaContainer] Failed (${containerResponse.status}): ${containerText}`,
      );
      return buildHttpFailure({
        platform: "instagram",
        action,
        httpStatus: containerResponse.status,
        responseText: containerText,
        isPublishRequest: false,
      });
    }
    const createdContainer = CreatedObjectSchema.safeParse(
      parseJsonObject(containerText),
    );
    if (!createdContainer.success) {
      return buildUnreadableAnswerFailure({ action, isPublishRequest: false });
    }
    return { success: true, containerId: createdContainer.data.id };
  } catch (requestError) {
    return buildNetworkFailure({ action, requestError, isPublishRequest: false });
  }
}

async function readContainerStatus(
  accessToken: string,
  containerId: string,
): Promise<string | null> {
  try {
    const statusResponse = await fetch(
      `${INSTAGRAM_GRAPH_BASE_URL}/${containerId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`,
      { signal: AbortSignal.timeout(PLATFORM_API_TIMEOUT_MS) },
    );
    const statusText = await statusResponse.text();
    if (!statusResponse.ok) {
      console.warn(
        `[readContainerStatus] Status check failed (${statusResponse.status}): ${statusText}`,
      );
      return null;
    }
    const containerStatus = ContainerStatusSchema.safeParse(
      parseJsonObject(statusText),
    );
    return containerStatus.success ? containerStatus.data.status_code : null;
  } catch (requestError) {
    console.warn(
      "[readContainerStatus] Status request failed:",
      requestError instanceof Error ? requestError.message : requestError,
    );
    return null;
  }
}

function waitFor(durationMs: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, durationMs));
}

async function waitForContainerReady(
  accessToken: string,
  containerId: string,
): Promise<{ success: true } | PlatformPostFailure> {
  const deadlineMs = Date.now() + CONTAINER_READY_DEADLINE_MS;
  let pollIndex = 0;
  let lastStatus: string | null = null;

  for (;;) {
    lastStatus = await readContainerStatus(accessToken, containerId);
    if (lastStatus === "FINISHED") return { success: true };
    if (lastStatus === "ERROR" || lastStatus === "EXPIRED") {
      return buildInputFailure(`Instagram could not process the media (container ${lastStatus})`);
    }

    const pollIntervalMs = Math.min(
      CONTAINER_POLL_MAX_INTERVAL_MS,
      CONTAINER_POLL_INITIAL_INTERVAL_MS * 2 ** pollIndex,
    );
    if (Date.now() + pollIntervalMs > deadlineMs) break;
    await waitFor(pollIntervalMs);
    pollIndex++;
  }

  return {
    success: false,
    error: `Instagram media processing timeout: not ready after ${CONTAINER_READY_DEADLINE_MS / 1000} s (last status: ${lastStatus ?? "unreadable"})`,
    failure: { reason: "transient", mayHavePublished: false },
  };
}

async function readMediaPermalink(
  accessToken: string,
  mediaId: string,
): Promise<string | undefined> {
  try {
    const permalinkResponse = await fetch(
      `${INSTAGRAM_GRAPH_BASE_URL}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`,
      { signal: AbortSignal.timeout(PLATFORM_API_TIMEOUT_MS) },
    );
    if (!permalinkResponse.ok) {
      console.warn(
        `[readMediaPermalink] Permalink lookup failed (${permalinkResponse.status}) for media ${mediaId}`,
      );
      return undefined;
    }
    const media = MediaPermalinkSchema.safeParse(
      parseJsonObject(await permalinkResponse.text()),
    );
    return media.success ? media.data.permalink : undefined;
  } catch (requestError) {
    console.warn(
      `[readMediaPermalink] Permalink request failed for media ${mediaId}:`,
      requestError instanceof Error ? requestError.message : requestError,
    );
    return undefined;
  }
}

export async function postToInstagram(input: {
  accessToken: string;
  igUserId: string;
  caption: string;
  mediaUrl: string;
  postType: "image" | "reel";
  altText?: string;
  shareToFeed?: boolean;
  coverTimestamp?: number;
}): Promise<InstagramPostResult> {
  if (!input.accessToken || !input.igUserId) {
    return buildInputFailure("Missing required parameters (accessToken and igUserId)");
  }
  if (!input.mediaUrl) {
    return buildInputFailure("Instagram requires media content. Please provide a public mediaUrl.");
  }

  const container = await createMediaContainer(input);
  if (!container.success) return container;

  const readiness = await waitForContainerReady(input.accessToken, container.containerId);
  if (!readiness.success) return readiness;

  const publishAction = `Instagram ${input.postType} publish`;
  let mediaId: string;
  try {
    const publishResponse = await fetch(
      `${INSTAGRAM_GRAPH_BASE_URL}/${input.igUserId}/media_publish`,
      {
        method: "POST",
        headers: buildAuthHeaders(input.accessToken),
        body: JSON.stringify({ creation_id: container.containerId }),
        signal: AbortSignal.timeout(PLATFORM_PUBLISH_TIMEOUT_MS),
      },
    );
    const publishText = await publishResponse.text();
    if (!publishResponse.ok) {
      console.error(
        `[postToInstagram] Publish failed (${publishResponse.status}): ${publishText}`,
      );
      return buildHttpFailure({
        platform: "instagram",
        action: publishAction,
        httpStatus: publishResponse.status,
        responseText: publishText,
        isPublishRequest: true,
      });
    }
    const publishedMedia = CreatedObjectSchema.safeParse(parseJsonObject(publishText));
    if (!publishedMedia.success) {
      return buildUnreadableAnswerFailure({ action: publishAction, isPublishRequest: true });
    }
    mediaId = publishedMedia.data.id;
  } catch (requestError) {
    return buildNetworkFailure({
      action: publishAction,
      requestError,
      isPublishRequest: true,
    });
  }

  console.log(`[postToInstagram] Published ${input.postType} media ${mediaId}`);
  return {
    success: true,
    postId: mediaId,
    postUrl: await readMediaPermalink(input.accessToken, mediaId),
    containerId: container.containerId,
    message: `Successfully created ${input.postType} post on Instagram`,
  };
}
