import "server-only";

import type {
  ProviderBehavior,
  ProviderConnectInput,
  ProviderConnectResult,
  ProviderPublishInput,
  ProviderPublishResult,
} from "./types";
import {
  parseJsonBody,
  providerFetch,
  readStringField,
} from "./_shared/providerFetch";

/**
 * WordPress provider, self-hosted mode.
 *
 * Uses an Application Password, which core WordPress has issued since 5.6:
 * the user creates one under Users, Profile, Application Passwords and
 * pastes it with their username. No plugin, no OAuth app, no review.
 *
 * The site URL is a connect field and therefore untrusted input, so every
 * call goes through providerFetch (DNS validated, IP pinned, redirects
 * refused). Without that, "your WordPress site" would be an open
 * request-forgery field.
 *
 * sourceRef: developer.wordpress.org/rest-api/reference (users/me, posts,
 * media).
 */

const WORDPRESS_TIMEOUT_MS = 30_000;
const WORDPRESS_MEDIA_TIMEOUT_MS = 60_000;

function normalizeSiteUrl(rawSiteUrl: string): string {
  return rawSiteUrl.trim().replace(/\/+$/, "");
}

function readSiteUrl(config: Record<string, unknown>): string | null {
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
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "credentials") {
    return {
      ok: false,
      message: "WordPress connects with an application password.",
    };
  }

  const siteUrl = normalizeSiteUrl(input.values.siteUrl ?? "");
  const username = (input.values.username ?? "").trim();
  // WordPress displays application passwords in spaced groups; the spaces
  // are presentational and the API rejects them.
  const applicationPassword = (input.values.applicationPassword ?? "").replace(
    /\s+/g,
    "",
  );

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

  const user = parseJsonBody(meResult.bodyText);
  const userId =
    user && typeof user === "object" && typeof (user as Record<string, unknown>).id === "number"
      ? String((user as Record<string, unknown>).id)
      : null;

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
    return {
      ok: false,
      message: "Stored WordPress account is missing its site URL.",
    };
  }

  const postTitle = input.title.trim();
  if (!postTitle) {
    return { ok: false, message: "WordPress posts require a title." };
  }

  const authorization = buildBasicAuthHeader(input.accessToken);

  // A cover image becomes the featured image, which is what a WordPress
  // theme expects, rather than being inlined at the top of the content.
  let featuredMediaId: number | null = null;
  if (input.mediaType === "image" && input.mediaUrl) {
    const uploadResult = await uploadMedia(
      siteUrl,
      authorization,
      input.mediaUrl,
      input.fileName,
      input.mediaMimeType,
    );
    if (!uploadResult.ok) return { ok: false, message: uploadResult.message };
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

  if (!createResult.ok) return { ok: false, message: createResult.message };
  if (createResult.status !== 201 && createResult.status !== 200) {
    return {
      ok: false,
      message: `WordPress post create failed (${createResult.status}): ${createResult.bodyText.slice(0, 300)}`,
    };
  }

  const created = parseJsonBody(createResult.bodyText);
  const postId =
    created && typeof created === "object" && typeof (created as Record<string, unknown>).id === "number"
      ? String((created as Record<string, unknown>).id)
      : null;

  if (!postId) {
    return { ok: false, message: "WordPress returned no post id." };
  }

  return { ok: true, postId, postUrl: readStringField(created, "link") };
}

type MediaUploadResult =
  | { ok: true; mediaId: number }
  | { ok: false; message: string };

/**
 * Uploads media to the site's library. Our own signed URL supplies the
 * bytes, so that read needs no SSRF guard; the site call gets one.
 *
 * WordPress accepts a raw body with Content-Disposition rather than a
 * multipart envelope, which keeps this simple.
 */
async function uploadMedia(
  siteUrl: string,
  authorization: string,
  mediaUrl: string,
  fileName: string,
  mimeType: string,
): Promise<MediaUploadResult> {
  let mediaBytes: Uint8Array;
  try {
    const mediaResponse = await fetch(mediaUrl);
    if (!mediaResponse.ok) {
      return {
        ok: false,
        message: `Could not read the post media (HTTP ${mediaResponse.status}).`,
      };
    }
    mediaBytes = new Uint8Array(await mediaResponse.arrayBuffer());
  } catch (mediaError) {
    return {
      ok: false,
      message: `Could not read the post media: ${
        mediaError instanceof Error ? mediaError.message : "unknown error"
      }`,
    };
  }

  // Strip anything that could break out of the header value; the filename
  // comes from stored data but this header is attacker-adjacent input.
  const safeFileName = fileName.replace(/[^A-Za-z0-9._-]/g, "_") || "upload";

  const uploadResult = await providerFetch(`${siteUrl}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${safeFileName}"`,
    },
    body: mediaBytes,
    timeoutMs: WORDPRESS_MEDIA_TIMEOUT_MS,
  });

  if (!uploadResult.ok) return { ok: false, message: uploadResult.message };
  if (uploadResult.status !== 201 && uploadResult.status !== 200) {
    return {
      ok: false,
      message: `WordPress media upload failed (${uploadResult.status}).`,
    };
  }

  const uploaded = parseJsonBody(uploadResult.bodyText);
  const mediaId =
    uploaded && typeof uploaded === "object" && typeof (uploaded as Record<string, unknown>).id === "number"
      ? ((uploaded as Record<string, unknown>).id as number)
      : null;

  if (mediaId === null) {
    return { ok: false, message: "WordPress media upload returned no id." };
  }

  return { ok: true, mediaId };
}

export const wordpressBehavior: ProviderBehavior = { connect, publish };
