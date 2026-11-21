import "server-only";

import { z } from "zod";

import type { MediaType } from "@/db/schema";
import {
  buildHttpFailure,
  buildInputFailure,
  buildNetworkFailure,
  buildUnreadableAnswerFailure,
  type PlatformPostFailure,
} from "@/lib/api/_shared/platformFailure";
import {
  LINKEDIN_MEDIA_UPLOAD_TIMEOUT_MS,
  PLATFORM_API_TIMEOUT_MS,
  PLATFORM_PUBLISH_TIMEOUT_MS,
} from "@/lib/api/_shared/platformFetchTimeouts";
import { viewBufferAsFetchBody } from "@/lib/api/_shared/viewBufferAsFetchBody";
import { parseJsonObject } from "@/lib/platforms/providers/_shared/providerFetch";
import type { JsonObject } from "@/lib/utils/jsonObject";

const UPLOAD_HTTP_REQUEST_MECHANISM =
  "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest";

/**
 * registerUpload answer: the asset URN and the URL the bytes go to.
 * sourceRef: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
 */
const RegisterUploadSchema = z.object({
  value: z.object({
    asset: z.string().min(1),
    uploadMechanism: z.object({
      [UPLOAD_HTTP_REQUEST_MECHANISM]: z.object({ uploadUrl: z.string().min(1) }),
    }),
  }),
});

type ShareMedia = {
  status: "READY";
  description?: { text: string };
  media?: string;
  originalUrl?: string;
  title?: { text: string };
};

type ShareMediaCategory = "NONE" | "ARTICLE" | "IMAGE" | "VIDEO";

const SHARE_LABEL_BY_CATEGORY = {
  NONE: "text",
  ARTICLE: "link",
  IMAGE: "image",
  VIDEO: "video",
} satisfies Record<ShareMediaCategory, string>;

export const UNKNOWN_LINKEDIN_POST_ID = "unknown-post-id";

export type LinkedInPostResult =
  | { success: true; postId: string | undefined; data: JsonObject; message: string }
  | PlatformPostFailure;

type MediaUploadOutcome =
  | { success: true; assetUrn: string }
  | PlatformPostFailure;

async function uploadMediaAsset({
  accessToken,
  authorUrn,
  postType,
  mediaType,
  buffer,
}: {
  accessToken: string;
  authorUrn: string;
  postType: "image" | "video";
  mediaType: string;
  buffer: Buffer;
}): Promise<MediaUploadOutcome> {
  const registerAction = `LinkedIn ${postType} upload registration`;
  let assetUrn: string;
  let uploadUrl: string;
  try {
    const registerResponse = await fetch(
      "https://api.linkedin.com/v2/assets?action=registerUpload",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify({
          registerUploadRequest: {
            recipes: [
              postType === "image"
                ? "urn:li:digitalmediaRecipe:feedshare-image"
                : "urn:li:digitalmediaRecipe:feedshare-video",
            ],
            owner: authorUrn,
            serviceRelationships: [
              {
                relationshipType: "OWNER",
                identifier: "urn:li:userGeneratedContent",
              },
            ],
          },
        }),
        signal: AbortSignal.timeout(PLATFORM_API_TIMEOUT_MS),
      },
    );
    const registerText = await registerResponse.text();
    if (!registerResponse.ok) {
      console.error(
        `[uploadMediaAsset] Register upload failed (${registerResponse.status}): ${registerText}`,
      );
      return buildHttpFailure({
        platform: "linkedin",
        action: registerAction,
        httpStatus: registerResponse.status,
        responseText: registerText,
        isPublishRequest: false,
      });
    }
    const registration = RegisterUploadSchema.safeParse(
      parseJsonObject(registerText),
    );
    if (!registration.success) {
      console.error("[uploadMediaAsset] Register upload answer had an unexpected shape");
      return buildUnreadableAnswerFailure({
        action: registerAction,
        isPublishRequest: false,
      });
    }
    assetUrn = registration.data.value.asset;
    uploadUrl =
      registration.data.value.uploadMechanism[UPLOAD_HTTP_REQUEST_MECHANISM]
        .uploadUrl;
  } catch (requestError) {
    return buildNetworkFailure({
      action: registerAction,
      requestError,
      isPublishRequest: false,
    });
  }

  const uploadAction = `LinkedIn ${postType} upload`;
  try {
    const uploadResponse = await fetch(uploadUrl, {
      method: postType === "video" ? "POST" : "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": mediaType,
      },
      body: viewBufferAsFetchBody(buffer),
      signal: AbortSignal.timeout(LINKEDIN_MEDIA_UPLOAD_TIMEOUT_MS),
    });
    if (!uploadResponse.ok) {
      const uploadText = await uploadResponse.text();
      console.error(
        `[uploadMediaAsset] Upload failed (${uploadResponse.status}): ${uploadText}`,
      );
      return buildHttpFailure({
        platform: "linkedin",
        action: uploadAction,
        httpStatus: uploadResponse.status,
        responseText: uploadText,
        isPublishRequest: false,
      });
    }
  } catch (requestError) {
    return buildNetworkFailure({
      action: uploadAction,
      requestError,
      isPublishRequest: false,
    });
  }

  return { success: true, assetUrn };
}

/**
 * Publishes one share through v2/ugcPosts for a member or an organization
 * author. Image and video shares upload the bytes as an asset first; a text
 * post with a link becomes an ARTICLE share.
 * sourceRef: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
 */
export async function postToLinkedIn({
  accessToken,
  authorUrn,
  text,
  title,
  link,
  mediaType,
  postType,
  buffer,
}: {
  accessToken: string;
  authorUrn: string;
  text: string;
  title?: string;
  link?: string;
  postType: MediaType;
  mediaType?: string;
  buffer?: Buffer;
}): Promise<LinkedInPostResult> {
  if (!accessToken || !authorUrn) {
    console.error("[postToLinkedIn] Missing access token or author URN");
    return buildInputFailure("Missing required parameters (accessToken and authorUrn)");
  }

  let shareMediaCategory: ShareMediaCategory = "NONE";
  let shareMedia: ShareMedia[] = [];

  if (postType !== "text") {
    if (!buffer || buffer.length === 0) {
      return buildInputFailure("Failed to retrieve media file from storage");
    }
    if (!mediaType) {
      return buildInputFailure("Media type is required for media uploads");
    }
    const uploadOutcome = await uploadMediaAsset({
      accessToken,
      authorUrn,
      postType,
      mediaType,
      buffer,
    });
    if (!uploadOutcome.success) {
      return uploadOutcome;
    }
    shareMediaCategory = postType === "image" ? "IMAGE" : "VIDEO";
    shareMedia = [
      {
        status: "READY",
        description: { text },
        media: uploadOutcome.assetUrn,
        title: title ? { text: title } : undefined,
      },
    ];
  } else if (link) {
    shareMediaCategory = "ARTICLE";
    shareMedia = [
      {
        status: "READY",
        description: { text: title ?? text },
        originalUrl: link,
        title: title ? { text: title } : undefined,
      },
    ];
  }

  const publishAction = "LinkedIn share creation";
  try {
    const shareResponse = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author: authorUrn,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text },
            shareMediaCategory,
            media: shareMedia.length > 0 ? shareMedia : undefined,
          },
        },
        visibility: {
          "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
        },
      }),
      signal: AbortSignal.timeout(PLATFORM_PUBLISH_TIMEOUT_MS),
    });
    const shareText = await shareResponse.text();

    if (!shareResponse.ok) {
      console.error(
        `[postToLinkedIn] Share creation failed (${shareResponse.status}): ${shareText}`,
      );
      return buildHttpFailure({
        platform: "linkedin",
        action: publishAction,
        httpStatus: shareResponse.status,
        responseText: shareText,
        isPublishRequest: true,
      });
    }

    const shareBody = parseJsonObject(shareText) ?? {};
    const bodyPostId = shareBody.id;
    const postId =
      shareResponse.headers.get("x-restli-id") ??
      (typeof bodyPostId === "string" ? bodyPostId : null);
    if (!postId) {
      console.warn(
        `[postToLinkedIn] Share created (${shareResponse.status}) without a post id in the answer`,
      );
    }

    return {
      success: true,
      postId: postId || undefined,
      data: shareBody,
      message: `Successfully created ${SHARE_LABEL_BY_CATEGORY[shareMediaCategory]} post on LinkedIn`,
    };
  } catch (requestError) {
    return buildNetworkFailure({
      action: publishAction,
      requestError,
      isPublishRequest: true,
    });
  }
}
