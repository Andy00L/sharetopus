import "server-only";

import { setTimeout as sleep } from "node:timers/promises";

import type {
  OAuthCodeConnectInput,
  ProviderBehavior,
  ProviderConnectResult,
  ProviderPublishFailure,
  ProviderPublishInput,
  ProviderPublishResult,
  ProviderRefreshInput,
  ProviderRefreshResult,
} from "./types";
import { toJsonObject } from "@/lib/utils/jsonObject";

import {
  parseJsonBody,
  providerFetch,
  readStringField,
} from "./_shared/providerFetch";
import {
  failHttpAnswer,
  failProviderFetch,
  failPublish,
  failUnreadableAnswer,
} from "./_shared/publishFailure";
import {
  buildOAuth2AuthorizeUrl,
  classifyTokenHttpStatus,
  exchangeOAuth2Code,
  type OAuth2Config,
} from "./_shared/oauth2";
import { joinTitleAndBody } from "./_shared/postText";

/**
 * Two-step publish: create a media container, then publish it. The short
 * lived code-exchange token is immediately traded for a long-lived one
 * (~60 days) so scheduled posts do not die within the hour. A long-lived
 * token renews for another 60 days once it is at least 24 hours old and
 * not expired; an expired one cannot be renewed.
 *
 * sourceRef: developers.facebook.com/docs/threads (oauth/access_token,
 * access_token th_exchange_token, refresh_access_token th_refresh_token,
 * {id}/threads, {id}/threads_publish).
 */

const THREADS_GRAPH_ORIGIN = "https://graph.threads.net";
const THREADS_GRAPH = `${THREADS_GRAPH_ORIGIN}/v1.0`;
const THREADS_TIMEOUT_MS = 30_000;
/** Long-lived Threads tokens last about 60 days. */
const THREADS_LONG_LIVED_TTL_SECONDS = 60 * 24 * 60 * 60;

const CONTAINER_STATUS_TIMEOUT_MS = 10_000;
const CONTAINER_POLL_INTERVAL_MS = 10_000;
const CONTAINER_WAIT_DEADLINE_MS = 120_000;

// developers.facebook.com/docs/threads/troubleshooting ("Publishing does not
// return a media ID"): container status and error_message values.
const CONTAINER_ERROR_REASONS = new Map<string, "transient" | "invalid_input">([
  ["FAILED_DOWNLOADING_VIDEO", "transient"],
  ["INVALID_ASPEC_RATIO", "invalid_input"],
  ["INVALID_BIT_RATE", "invalid_input"],
  ["INVALID_DURATION", "invalid_input"],
  ["INVALID_FRAME_RATE", "invalid_input"],
  ["INVALID_AUDIO_CHANNELS", "invalid_input"],
  ["INVALID_AUDIO_CHANNEL_LAYOUT", "invalid_input"],
]);

type LongLivedToken = { accessToken: string; expiresInSeconds: number };

function readLongLivedToken(bodyText: string): LongLivedToken | null {
  const tokenBody = parseJsonBody(bodyText);
  const accessToken = readStringField(tokenBody, "access_token");
  if (!accessToken) return null;
  const expiresIn = toJsonObject(tokenBody)?.expires_in;
  return {
    accessToken,
    expiresInSeconds:
      typeof expiresIn === "number" && expiresIn > 0
        ? expiresIn
        : THREADS_LONG_LIVED_TTL_SECONDS,
  };
}

const THREADS_OAUTH: OAuth2Config = {
  authorizeUrl: "https://threads.net/oauth/authorize",
  tokenUrl: "https://graph.threads.net/oauth/access_token",
  clientIdEnv: "THREADS_CLIENT_ID",
  clientSecretEnv: "THREADS_CLIENT_SECRET",
  scope: "threads_basic,threads_content_publish",
  useBasicAuthForToken: false,
};

async function connect(
  input: OAuthCodeConnectInput,
): Promise<ProviderConnectResult> {
  const shortLived = await exchangeOAuth2Code(THREADS_OAUTH, input);
  if (!shortLived.ok) return { ok: false, message: shortLived.message };

  const clientSecret = process.env.THREADS_CLIENT_SECRET ?? "";
  const exchangeUrl =
    `${THREADS_GRAPH_ORIGIN}/access_token` +
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
  const longLivedToken = readLongLivedToken(longLivedResult.bodyText);
  if (!longLivedToken) {
    return { ok: false, message: "Threads returned no long-lived token." };
  }
  const { accessToken } = longLivedToken;

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
    expiresIn: longLivedToken.expiresInSeconds,
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

  const text = joinTitleAndBody(input);

  const containerParams = new URLSearchParams({
    access_token: input.accessToken,
    text,
  });
  if (input.postType === "image" && input.mediaUrl) {
    containerParams.set("media_type", "IMAGE");
    containerParams.set("image_url", input.mediaUrl);
  } else if (input.postType === "video" && input.mediaUrl) {
    containerParams.set("media_type", "VIDEO");
    containerParams.set("video_url", input.mediaUrl);
  } else {
    containerParams.set("media_type", "TEXT");
  }
  const isMediaContainer = containerParams.get("media_type") !== "TEXT";

  const containerResult = await providerFetch(
    `${THREADS_GRAPH}/${userId}/threads`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: containerParams.toString(),
      timeoutMs: THREADS_TIMEOUT_MS,
    },
  );
  if (!containerResult.ok) {
    return failProviderFetch({
      platform: "threads",
      stage: "prepare",
      fetchFailure: containerResult,
    });
  }
  if (containerResult.status !== 200) {
    return failHttpAnswer({
      platform: "threads",
      stage: "prepare",
      action: "Threads container create",
      httpStatus: containerResult.status,
      bodyText: containerResult.bodyText,
    });
  }
  const creationId = readStringField(
    parseJsonBody(containerResult.bodyText),
    "id",
  );
  if (!creationId) {
    return failUnreadableAnswer({
      message: "Threads returned no creation id.",
      stage: "prepare",
    });
  }

  if (isMediaContainer) {
    const containerWait = await waitForFinishedContainer(creationId, input.accessToken);
    if (!containerWait.ok) return containerWait;
  }

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
  if (!publishResult.ok) {
    return failProviderFetch({
      platform: "threads",
      stage: "publish",
      fetchFailure: publishResult,
    });
  }
  if (publishResult.status !== 200) {
    return failHttpAnswer({
      platform: "threads",
      stage: "publish",
      action: "Threads publish",
      httpStatus: publishResult.status,
      bodyText: publishResult.bodyText,
    });
  }
  const mediaId = readStringField(parseJsonBody(publishResult.bodyText), "id");
  if (!mediaId) {
    return failUnreadableAnswer({
      message: "Threads returned no media id.",
      stage: "publish",
    });
  }

  return { ok: true, postId: mediaId, postUrl: null };
}

async function waitForFinishedContainer(
  creationId: string,
  accessToken: string,
): Promise<{ ok: true } | ProviderPublishFailure> {
  const deadlineMs = Date.now() + CONTAINER_WAIT_DEADLINE_MS;
  for (;;) {
    const statusResult = await providerFetch(
      `${THREADS_GRAPH}/${encodeURIComponent(creationId)}?fields=status,error_message` +
        `&access_token=${encodeURIComponent(accessToken)}`,
      { method: "GET", timeoutMs: CONTAINER_STATUS_TIMEOUT_MS },
    );
    if (!statusResult.ok) {
      return failProviderFetch({
        platform: "threads",
        stage: "prepare",
        fetchFailure: statusResult,
      });
    }
    if (statusResult.status !== 200) {
      return failHttpAnswer({
        platform: "threads",
        stage: "prepare",
        action: "Threads container status",
        httpStatus: statusResult.status,
        bodyText: statusResult.bodyText,
      });
    }

    const statusBody = parseJsonBody(statusResult.bodyText);
    const containerStatus = readStringField(statusBody, "status");
    const errorMessage = readStringField(statusBody, "error_message");
    switch (containerStatus) {
      case "FINISHED":
        return { ok: true };
      case "IN_PROGRESS":
        break;
      case "ERROR":
        return failPublish({
          message: `Threads could not process the media (${errorMessage ?? "no reason given"}).`,
          reason: CONTAINER_ERROR_REASONS.get(errorMessage ?? "") ?? "unknown",
          mayHavePublished: false,
        });
      case "EXPIRED":
        return failPublish({
          message: "The Threads media container expired before it was published.",
          reason: "transient",
          mayHavePublished: false,
        });
      case "PUBLISHED":
        return failUnreadableAnswer({
          message: "The Threads media container is already published.",
          stage: "publish",
        });
      default:
        return failUnreadableAnswer({
          message: `Threads returned an unknown container status (${containerStatus ?? "none"}).`,
          stage: "prepare",
        });
    }

    if (Date.now() + CONTAINER_POLL_INTERVAL_MS > deadlineMs) {
      return failPublish({
        message: `Threads was still processing the media after ${CONTAINER_WAIT_DEADLINE_MS / 1000} seconds.`,
        reason: "transient",
        mayHavePublished: false,
      });
    }
    await sleep(CONTAINER_POLL_INTERVAL_MS);
  }
}

async function refresh(input: ProviderRefreshInput): Promise<ProviderRefreshResult> {
  if (!input.accessToken) {
    return { ok: false, message: "No Threads token is stored.", reason: "auth_expired" };
  }
  const refreshResult = await providerFetch(
    `${THREADS_GRAPH_ORIGIN}/refresh_access_token?grant_type=th_refresh_token` +
      `&access_token=${encodeURIComponent(input.accessToken)}`,
    { method: "GET", timeoutMs: THREADS_TIMEOUT_MS },
  );
  if (!refreshResult.ok) {
    return {
      ok: false,
      message: `Threads token refresh failed: ${refreshResult.message}`,
      reason: "transient",
    };
  }
  if (refreshResult.status !== 200) {
    return {
      ok: false,
      message: `Threads token refresh failed (HTTP ${refreshResult.status}).`,
      reason: classifyTokenHttpStatus(refreshResult.status),
    };
  }
  const refreshedToken = readLongLivedToken(refreshResult.bodyText);
  if (!refreshedToken) {
    return {
      ok: false,
      message: "Threads token refresh returned no access token.",
      reason: "transient",
    };
  }
  return {
    ok: true,
    accessToken: refreshedToken.accessToken,
    rotatedRefreshToken: null,
    expiresIn: refreshedToken.expiresInSeconds,
  };
}

export const threadsBehavior = {
  authKind: "oauth2",
  connect,
  publish,
  refresh,
  buildAuthorizeUrl: (input) => buildOAuth2AuthorizeUrl(THREADS_OAUTH, input),
} satisfies ProviderBehavior;
