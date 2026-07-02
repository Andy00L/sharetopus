import "server-only";

import { z } from "zod";

/** Feed and photo publishes are quick JSON calls; 30s covers them. */
const PUBLISH_TIMEOUT_MS = 30_000;
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

export interface FacebookPostResult {
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
  details?: Record<string, unknown>;
  message?: string;
}

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
    return {
      success: false,
      error: "Missing required parameters (pageAccessToken and pageId)",
    };
  }
  if (postType !== "text" && !mediaUrl) {
    console.error("[postToFacebook] Media post without media URL");
    return {
      success: false,
      error: "Media URL is required for image and video posts",
    };
  }

  let endpoint: string;
  let body: Record<string, string>;
  let timeoutMs = PUBLISH_TIMEOUT_MS;

  switch (postType) {
    case "text":
      endpoint = `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/feed`;
      body = { message };
      break;
    case "image":
      endpoint = `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/photos`;
      body = { url: mediaUrl!, caption: message };
      break;
    case "video":
      endpoint = `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/videos`;
      body = { file_url: mediaUrl!, description: message };
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
      return {
        success: false,
        error: `Facebook ${postType} publish failed (${response.status})`,
        details: parseErrorDetails(responseText),
      };
    }

    const parsed = FacebookPublishSchema.safeParse(JSON.parse(responseText));
    if (!parsed.success) {
      console.error("[postToFacebook] Publish response failed validation.");
      return {
        success: false,
        error: "Facebook publish response had an unexpected shape",
      };
    }

    // Prefer the feed post id (photos return both a media id and post_id).
    const postId = parsed.data.post_id ?? parsed.data.id;
    console.log(`[postToFacebook] Published ${postType} post ${postId}`);

    return {
      success: true,
      postId,
      postUrl: `https://www.facebook.com/${postId}`,
      message: `Successfully created ${postType} post on Facebook`,
    };
  } catch (error) {
    console.error(
      "[postToFacebook] Publish error:",
      error instanceof Error ? error.message : error,
    );
    return { success: false, error: "Facebook publish request failed" };
  }
}

/** Best-effort JSON parse of a provider error body for the details field. */
function parseErrorDetails(errorText: string): Record<string, unknown> {
  try {
    const parsedBody = JSON.parse(errorText) as unknown;
    if (parsedBody !== null && typeof parsedBody === "object") {
      return parsedBody as Record<string, unknown>;
    }
    return { rawError: errorText };
  } catch {
    return { rawError: errorText };
  }
}
