import "server-only";

import { z } from "zod";

import { PLATFORM_PUBLISH_TIMEOUT_MS } from "@/lib/api/_shared/platformFetchTimeouts";
import {
  buildHttpFailure,
  buildInputFailure,
  buildNetworkFailure,
  buildUnreadableAnswerFailure,
  type PlatformPostFailure,
} from "@/lib/api/_shared/platformFailure";
import { parseJsonObject } from "@/lib/platforms/providers/_shared/providerFetch";

/** Video publish makes Facebook pull file_url server-side; allow 2 minutes. */
const VIDEO_PUBLISH_TIMEOUT_MS = 120_000;

/** Graph API version pinned across the repo; see exchangeFacebookCode.ts. */
const GRAPH_API_VERSION = "v23.0";

/**
 * Publish response shapes.
 *   /feed   -> { id: "<pageId>_<postId>" }
 *   /photos -> { id: "<photoId>", post_id: "<pageId>_<postId>" }
 *   /videos -> { id: "<videoId>" }
 * sourceRef: https://developers.facebook.com/docs/pages-api/posts/
 */
const FacebookPublishSchema = z.object({
  id: z.string().min(1),
  post_id: z.string().optional(),
});

export type FacebookPostResult =
  | { success: true; postId: string; postUrl: string; message: string }
  | PlatformPostFailure;

/**
 * Publish one post to one Facebook Page with its PAGE access token:
 *   - text:  POST /{pageId}/feed with message
 *   - image: POST /{pageId}/photos with url (Facebook pulls the file)
 *   - video: POST /{pageId}/videos with file_url (Facebook pulls the file)
 *
 * mediaUrl must be publicly reachable for the pull duration; the signed
 * Supabase URL minted by the direct-post pipeline satisfies that.
 * sourceRef: https://developers.facebook.com/docs/pages-api/posts/,
 *            https://developers.facebook.com/docs/graph-api/reference/page/videos/
 *
 * Called by: directPostForFacebookAccounts
 */
export async function postToFacebook({
  pageAccessToken,
  pageId,
  message,
  mediaUrl,
  postType,
}: {
  pageAccessToken: string;
  pageId: string;
  message: string;
  mediaUrl?: string;
  postType: "text" | "image" | "video";
}): Promise<FacebookPostResult> {
  if (!pageAccessToken || !pageId) {
    console.error("[postToFacebook] Missing page token or page id");
    return buildInputFailure(
      "Missing required parameters (pageAccessToken and pageId)",
    );
  }
  if (postType !== "text" && !mediaUrl) {
    console.error("[postToFacebook] Media post without media URL");
    return buildInputFailure("Media URL is required for image and video posts");
  }

  let endpoint: string;
  let body: Record<string, string>;
  let timeoutMs = PLATFORM_PUBLISH_TIMEOUT_MS;

  switch (postType) {
    case "text":
      endpoint = `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/feed`;
      body = { message };
      break;
    case "image":
      endpoint = `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/photos`;
      body = { url: mediaUrl ?? "", caption: message };
      break;
    case "video":
      endpoint = `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/videos`;
      body = { file_url: mediaUrl ?? "", description: message };
      timeoutMs = VIDEO_PUBLISH_TIMEOUT_MS;
      break;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pageAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(
        `[postToFacebook] Publish failed (${response.status}): ${responseText}`,
      );
      return buildHttpFailure({
        platform: "facebook",
        action: `Facebook ${postType} publish`,
        httpStatus: response.status,
        responseText,
        isPublishRequest: true,
      });
    }

    const parsed = FacebookPublishSchema.safeParse(parseJsonObject(responseText));
    if (!parsed.success) {
      console.error("[postToFacebook] Publish response failed validation.");
      return buildUnreadableAnswerFailure({
        action: `Facebook ${postType} publish`,
        isPublishRequest: true,
      });
    }

    const postId = parsed.data.post_id ?? parsed.data.id;
    console.log(`[postToFacebook] Published ${postType} post ${postId}`);

    return {
      success: true,
      postId,
      postUrl: `https://www.facebook.com/${postId}`,
      message: `Successfully created ${postType} post on Facebook`,
    };
  } catch (requestError) {
    console.error(
      "[postToFacebook] Publish error:",
      requestError instanceof Error ? requestError.message : requestError,
    );
    return buildNetworkFailure({
      action: `Facebook ${postType} publish`,
      requestError,
      isPublishRequest: true,
    });
  }
}
