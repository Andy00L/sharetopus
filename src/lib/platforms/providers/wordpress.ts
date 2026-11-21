import "server-only";

import type {
  CredentialsConnectInput,
  ProviderBehavior,
  ProviderConfig,
  ProviderConnectResult,
  ProviderPublishFailure,
  ProviderPublishInput,
  ProviderPublishResult,
} from "./types";
import {
  parseJsonObject,
  providerFetch,
  readStringField,
} from "./_shared/providerFetch";
import {
  fetchStoredMedia,
  STORED_MEDIA_MAX_BYTES,
} from "./_shared/fetchStoredMedia";
import type { SignedStorageUrl } from "./_shared/signedStorageUrl";
import { toUploadFileName } from "./_shared/uploadFileName";
import {
  failHttpAnswer,
  failProviderFetch,
  failUnreadableAnswer,
  refusePublish,
} from "./_shared/publishFailure";

const WORDPRESS_TIMEOUT_MS = 30_000;
const WORDPRESS_MEDIA_TIMEOUT_MS = 60_000;

function normalizeSiteUrl(rawSiteUrl: string): string {
  return rawSiteUrl.trim().replace(/\/+$/, "");
}

function readSiteUrl(config: ProviderConfig): string | null {
  const siteUrl = config.siteUrl;
  if (typeof siteUrl !== "string" || siteUrl.trim().length === 0) return null;
  return normalizeSiteUrl(siteUrl);
}

/**
 * Application Passwords authenticate with HTTP Basic. The credential is
 * stored as "username:password" so one access_token column carries both.
 */
function buildBasicAuthHeader(credential: string): string {
  return `Basic ${Buffer.from(credential, "utf-8").toString("base64")}`;
}

async function connect(
  input: CredentialsConnectInput,
): Promise<ProviderConnectResult> {
  const siteUrl = normalizeSiteUrl(input.values.siteUrl ?? "");
  const username = (input.values.username ?? "").trim();
  const applicationPassword = input.values.applicationPassword ?? "";

  if (!siteUrl || !username || !applicationPassword) {
    return {
      ok: false,
      message: "Site URL, username, and application password are all required.",
    };
  }

  const credential = `${username}:${applicationPassword}`;

  const meResult = await providerFetch(
    `${siteUrl}/wp-json/wp/v2/users/me?context=edit`,
    {
      method: "GET",
      headers: { Authorization: buildBasicAuthHeader(credential) },
      timeoutMs: WORDPRESS_TIMEOUT_MS,
    },
  );

  if (!meResult.ok) return { ok: false, message: meResult.message };
  if (meResult.status === 401) {
    return {
      ok: false,
      message:
        "WordPress rejected the username or application password. Application passwords need https.",
    };
  }
  if (meResult.status === 404) {
    return {
      ok: false,
      message:
        "No REST API found at that address. Check the site URL and that the REST API is not disabled.",
    };
  }
  if (meResult.status !== 200) {
    return {
      ok: false,
      message: `WordPress returned HTTP ${meResult.status} while verifying the credentials.`,
    };
  }

  const user = parseJsonObject(meResult.bodyText);
  const userId = user && typeof user.id === "number" ? String(user.id) : null;

  if (!userId) {
    return { ok: false, message: "WordPress returned no user id." };
  }

  return {
    ok: true,
    accessToken: credential,
    refreshToken: null,
    // Application passwords do not expire; they are revoked by hand.
    expiresIn: null,
    identity: {
      accountIdentifier: `${siteUrl}#${userId}`,
      displayName: readStringField(user, "name"),
      username: readStringField(user, "slug") ?? username,
      avatarUrl: null,
    },
    config: { siteUrl, userId },
  };
}

async function publish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const siteUrl = readSiteUrl(input.config);
  if (!siteUrl) {
    return refusePublish("Stored WordPress account is missing its site URL.");
  }

  const postTitle = input.title.trim();
  if (!postTitle) {
    return refusePublish("WordPress posts require a title.");
  }

  const authorization = buildBasicAuthHeader(input.accessToken);

  let featuredMediaId: number | null = null;
  if (input.postType === "image" && input.mediaUrl) {
    const uploadResult = await uploadMedia(
      siteUrl,
      authorization,
      input.mediaUrl,
      input.fileName,
      input.mediaMimeType,
    );
    if (!uploadResult.ok) return uploadResult;
    featuredMediaId = uploadResult.mediaId;
  }

  const postPayload: Record<string, unknown> = {
    title: postTitle,
    content: input.body,
    status: "publish",
  };
  if (featuredMediaId !== null) postPayload.featured_media = featuredMediaId;

  const createResult = await providerFetch(`${siteUrl}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authorization,
    },
    body: JSON.stringify(postPayload),
    timeoutMs: WORDPRESS_TIMEOUT_MS,
  });

  if (!createResult.ok) {
    return failProviderFetch({
      platform: "wordpress",
      stage: "publish",
      fetchFailure: createResult,
    });
  }
  if (createResult.status !== 201 && createResult.status !== 200) {
    return failHttpAnswer({
      platform: "wordpress",
      stage: "publish",
      action: "WordPress post create",
      httpStatus: createResult.status,
      bodyText: createResult.bodyText,
    });
  }

  const created = parseJsonObject(createResult.bodyText);
  const postId =
    created && typeof created.id === "number" ? String(created.id) : null;

  if (!postId) {
    return failUnreadableAnswer({
      message: "WordPress returned no post id.",
      stage: "publish",
    });
  }

  return { ok: true, postId, postUrl: readStringField(created, "link") };
}

type MediaUploadResult = { ok: true; mediaId: number } | ProviderPublishFailure;

/**
 * WordPress accepts a raw body with Content-Disposition rather than a
 * multipart envelope, which keeps this simple.
 */
async function uploadMedia(
  siteUrl: string,
  authorization: string,
  mediaUrl: SignedStorageUrl,
  fileName: string,
  mimeType: string,
): Promise<MediaUploadResult> {
  const storedMedia = await fetchStoredMedia(mediaUrl, STORED_MEDIA_MAX_BYTES);
  if (!storedMedia.ok) return storedMedia;


  const uploadResult = await providerFetch(`${siteUrl}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${toUploadFileName(fileName, "upload")}"`,
    },
    body: storedMedia.media,
    timeoutMs: WORDPRESS_MEDIA_TIMEOUT_MS,
  });

  if (!uploadResult.ok) {
    return failProviderFetch({
      platform: "wordpress",
      stage: "prepare",
      fetchFailure: uploadResult,
    });
  }
  if (uploadResult.status !== 201 && uploadResult.status !== 200) {
    return failHttpAnswer({
      platform: "wordpress",
      stage: "prepare",
      action: "WordPress media upload",
      httpStatus: uploadResult.status,
      bodyText: uploadResult.bodyText,
    });
  }

  const uploaded = parseJsonObject(uploadResult.bodyText);
  const mediaId =
    uploaded && typeof uploaded.id === "number" ? uploaded.id : null;

  if (mediaId === null) {
    return failUnreadableAnswer({
      message: "WordPress media upload returned no id.",
      stage: "prepare",
    });
  }

  return { ok: true, mediaId };
}

export const wordpressBehavior = {
  authKind: "credentials",
  connect,
  publish,
} satisfies ProviderBehavior;
