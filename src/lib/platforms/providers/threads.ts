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
import {
  buildOAuth2AuthorizeUrl,
  exchangeOAuth2Code,
  type OAuth2Config,
} from "./_shared/oauth2";

/**
 * Threads provider (Meta's Threads API).
 *
 * Two-step publish: create a media container, then publish it. The short
 * lived code-exchange token is immediately traded for a long-lived one
 * (~60 days) so scheduled posts do not die within the hour.
 *
 * sourceRef: developers.facebook.com/docs/threads (oauth/access_token,
 * access_token th_exchange_token, {id}/threads, {id}/threads_publish).
 */

const THREADS_GRAPH = "https://graph.threads.net/v1.0";
const THREADS_TIMEOUT_MS = 30_000;
/** Long-lived Threads tokens last about 60 days. */
const THREADS_LONG_LIVED_TTL_SECONDS = 60 * 24 * 60 * 60;

const THREADS_OAUTH: OAuth2Config = {
  authorizeUrl: "https://threads.net/oauth/authorize",
  tokenUrl: "https://graph.threads.net/oauth/access_token",
  clientIdEnv: "THREADS_CLIENT_ID",
  clientSecretEnv: "THREADS_CLIENT_SECRET",
  scope: "threads_basic,threads_content_publish",
  useBasicAuthForToken: false,
};

async function connect(
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "oauth_code") {
    return { ok: false, message: "Threads connects through OAuth." };
  }

  const shortLived = await exchangeOAuth2Code(THREADS_OAUTH, input);
  if (!shortLived.ok) return { ok: false, message: shortLived.message };

  // Trade for the long-lived token. A failure here is fatal on purpose:
  // storing the one-hour token would make every scheduled post a coin flip.
  const clientSecret = process.env.THREADS_CLIENT_SECRET ?? "";
  const exchangeUrl =
    `${THREADS_GRAPH.replace("/v1.0", "")}/access_token` +
    `?grant_type=th_exchange_token&client_secret=${encodeURIComponent(clientSecret)}` +
    `&access_token=${encodeURIComponent(shortLived.accessToken)}`;
  const longLivedResult = await providerFetch(exchangeUrl, {
    method: "GET",
    timeoutMs: THREADS_TIMEOUT_MS,
  });
  if (!longLivedResult.ok || longLivedResult.status !== 200) {
    return {
      ok: false,
      message: "Threads long-lived token exchange failed.",
    };
  }
  const longLivedBody = parseJsonBody(longLivedResult.bodyText);
  const accessToken = readStringField(longLivedBody, "access_token");
  if (!accessToken) {
    return { ok: false, message: "Threads returned no long-lived token." };
  }

  const profileResult = await providerFetch(
    `${THREADS_GRAPH}/me?fields=id,username,threads_profile_picture_url&access_token=${encodeURIComponent(accessToken)}`,
    { method: "GET", timeoutMs: THREADS_TIMEOUT_MS },
  );
  if (!profileResult.ok || profileResult.status !== 200) {
    return { ok: false, message: "Threads profile lookup failed." };
  }
  const profile = parseJsonBody(profileResult.bodyText);
  const userId = readStringField(profile, "id");
  if (!userId) return { ok: false, message: "Threads returned no user id." };

  return {
    ok: true,
    accessToken,
    refreshToken: null,
    expiresIn: THREADS_LONG_LIVED_TTL_SECONDS,
    identity: {
      accountIdentifier: userId,
      displayName: readStringField(profile, "username"),
      username: readStringField(profile, "username"),
      avatarUrl: readStringField(profile, "threads_profile_picture_url"),
    },
    config: { userId },
  };
}

async function publish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const userId =
    typeof input.config.userId === "string"
      ? input.config.userId
      : input.accountIdentifier;

  const text = [input.title.trim(), input.body.trim()]
    .filter((part) => part.length > 0)
    .join("\n\n");

  // Step 1: media container.
  const containerParams = new URLSearchParams({
    access_token: input.accessToken,
    text,
  });
  if (input.mediaType === "image" && input.mediaUrl) {
    containerParams.set("media_type", "IMAGE");
    containerParams.set("image_url", input.mediaUrl);
  } else if (input.mediaType === "video" && input.mediaUrl) {
    containerParams.set("media_type", "VIDEO");
    containerParams.set("video_url", input.mediaUrl);
  } else {
    containerParams.set("media_type", "TEXT");
  }

  const containerResult = await providerFetch(
    `${THREADS_GRAPH}/${userId}/threads`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: containerParams.toString(),
      timeoutMs: THREADS_TIMEOUT_MS,
    },
  );
  if (!containerResult.ok) return { ok: false, message: containerResult.message };
  if (containerResult.status !== 200) {
    return {
      ok: false,
      message: `Threads container create failed (${containerResult.status}): ${containerResult.bodyText.slice(0, 300)}`,
    };
  }
  const creationId = readStringField(
    parseJsonBody(containerResult.bodyText),
    "id",
  );
  if (!creationId) {
    return { ok: false, message: "Threads returned no creation id." };
  }

  // Step 2: publish the container.
  const publishParams = new URLSearchParams({
    access_token: input.accessToken,
    creation_id: creationId,
  });
  const publishResult = await providerFetch(
    `${THREADS_GRAPH}/${userId}/threads_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: publishParams.toString(),
      timeoutMs: THREADS_TIMEOUT_MS,
    },
  );
  if (!publishResult.ok) return { ok: false, message: publishResult.message };
  if (publishResult.status !== 200) {
    return {
      ok: false,
      message: `Threads publish failed (${publishResult.status}): ${publishResult.bodyText.slice(0, 300)}`,
    };
  }
  const mediaId = readStringField(parseJsonBody(publishResult.bodyText), "id");
  if (!mediaId) return { ok: false, message: "Threads returned no media id." };

  return { ok: true, postId: mediaId, postUrl: null };
}

export const threadsBehavior: ProviderBehavior = {
  connect,
  publish,
  buildAuthorizeUrl: (input) => buildOAuth2AuthorizeUrl(THREADS_OAUTH, input),
};
