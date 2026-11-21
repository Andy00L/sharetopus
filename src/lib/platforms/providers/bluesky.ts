import "server-only";

import type {
  ProviderBehavior,
  ProviderConnectInput,
  ProviderConnectResult,
  ProviderPublishFailure,
  ProviderPublishInput,
  ProviderPublishResult,
  ProviderRefreshInput,
  ProviderRefreshResult,
} from "./types";
import {
  parseJsonBody,
  parseJsonObject,
  providerFetch,
  readStringField,
} from "./_shared/providerFetch";
import { fetchStoredMedia } from "./_shared/fetchStoredMedia";
import { classifyTokenHttpStatus } from "./_shared/oauth2";
import {
  failHttpAnswer,
  failProviderFetch,
  failUnreadableAnswer,
  refusePublish,
} from "./_shared/publishFailure";

const DEFAULT_BLUESKY_SERVICE = "https://bsky.social";

const BLUESKY_SESSION_TTL_SECONDS = 60 * 60;

const BLUESKY_TIMEOUT_MS = 20_000;

// bluesky-social/bsky lexicons/app/bsky/embed/images.json: the image blob
// "May be up to 2 MB, formerly limited to 1 MB", "maxSize": 2000000.
const BLUESKY_MAX_IMAGE_BYTES = 2_000_000;

function resolveServiceUrl(config: Record<string, unknown>): string {
  const configured = config.service;
  if (typeof configured === "string" && configured.trim().length > 0) {
    return configured.trim().replace(/\/+$/, "");
  }
  return DEFAULT_BLUESKY_SERVICE;
}

async function connect(
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "credentials") {
    return { ok: false, message: "Bluesky connects with an app password." };
  }

  const service = resolveServiceUrl(input.values);
  const identifier = (input.values.identifier ?? "").trim();
  const appPassword = input.values.appPassword ?? "";

  if (!identifier || !appPassword) {
    return { ok: false, message: "Handle and app password are both required." };
  }

  const sessionResult = await providerFetch(
    `${service}/xrpc/com.atproto.server.createSession`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password: appPassword }),
      timeoutMs: BLUESKY_TIMEOUT_MS,
    },
  );

  if (!sessionResult.ok) {
    return { ok: false, message: sessionResult.message };
  }
  if (sessionResult.status !== 200) {
    // 401 here is a wrong handle or a revoked app password, which is the
    // user's problem to fix, so say so rather than reporting a generic error.
    const detail =
      sessionResult.status === 401
        ? "Bluesky rejected the handle or app password."
        : `Bluesky returned HTTP ${sessionResult.status}.`;
    return { ok: false, message: detail };
  }

  const session = parseJsonBody(sessionResult.bodyText);
  const accessJwt = readStringField(session, "accessJwt");
  const refreshJwt = readStringField(session, "refreshJwt");
  const did = readStringField(session, "did");
  const handle = readStringField(session, "handle");

  if (!accessJwt || !did) {
    return {
      ok: false,
      message: "Bluesky session response was missing accessJwt or did.",
    };
  }

  return {
    ok: true,
    accessToken: accessJwt,
    refreshToken: refreshJwt,
    expiresIn: BLUESKY_SESSION_TTL_SECONDS,
    identity: {
      accountIdentifier: did,
      displayName: handle,
      username: handle,
      avatarUrl: null,
    },
    config: { service, did, handle },
  };
}

async function refresh(input: ProviderRefreshInput): Promise<ProviderRefreshResult> {
  if (!input.refreshToken) {
    return { ok: false, message: "No Bluesky refresh token is stored.", reason: "auth_expired" };
  }
  // refreshSession authenticates with the refresh JWT itself, and it is
  // bound to the PDS that issued it.
  const refreshResult = await providerFetch(
    `${resolveServiceUrl(input.config)}/xrpc/com.atproto.server.refreshSession`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${input.refreshToken}` },
      timeoutMs: BLUESKY_TIMEOUT_MS,
    },
  );

  if (!refreshResult.ok) {
    return {
      ok: false,
      message: refreshResult.message,
      reason: "transient",
    };
  }
  if (refreshResult.status !== 200) {
    return {
      ok: false,
      message: `Bluesky session refresh failed (HTTP ${refreshResult.status}).`,
      reason: classifyTokenHttpStatus(refreshResult.status),
    };
  }

  const session = parseJsonBody(refreshResult.bodyText);
  const accessJwt = readStringField(session, "accessJwt");
  if (!accessJwt) {
    return {
      ok: false,
      message: "Bluesky refresh response was missing accessJwt.",
      reason: "transient",
    };
  }

  return {
    ok: true,
    accessToken: accessJwt,
    rotatedRefreshToken: readStringField(session, "refreshJwt"),
    expiresIn: BLUESKY_SESSION_TTL_SECONDS,
  };
}

async function publish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const service = resolveServiceUrl(input.config);
  const did = typeof input.config.did === "string" ? input.config.did : null;
  if (!did) {
    return refusePublish("Stored Bluesky account is missing its DID.");
  }

  const postText = buildPostText(input);

  // Image posts need the bytes uploaded as a blob first; the returned blob
  // ref is embedded in the record. Text posts skip this entirely.
  let embed: Record<string, unknown> | null = null;
  if (input.postType === "image" && input.mediaUrl) {
    const blobResult = await uploadImageBlob(
      service,
      input.accessToken,
      input.mediaUrl,
      input.mediaMimeType,
    );
    if (!blobResult.ok) return blobResult;
    embed = {
      $type: "app.bsky.embed.images",
      images: [{ alt: input.title || "", image: blobResult.blob }],
    };
  }

  const record: Record<string, unknown> = {
    $type: "app.bsky.feed.post",
    text: postText,
    createdAt: new Date().toISOString(),
  };
  if (embed) record.embed = embed;

  const createResult = await providerFetch(
    `${service}/xrpc/com.atproto.repo.createRecord`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.accessToken}`,
      },
      body: JSON.stringify({
        repo: did,
        collection: "app.bsky.feed.post",
        record,
      }),
      timeoutMs: BLUESKY_TIMEOUT_MS,
    },
  );

  if (!createResult.ok) {
    return failProviderFetch({
      platform: "bluesky",
      stage: "publish",
      fetchFailure: createResult,
    });
  }
  if (createResult.status !== 200) {
    return failHttpAnswer({
      platform: "bluesky",
      stage: "publish",
      action: "Bluesky createRecord",
      httpStatus: createResult.status,
      bodyText: createResult.bodyText,
    });
  }

  const created = parseJsonBody(createResult.bodyText);
  const uri = readStringField(created, "uri");
  if (!uri) {
    return failUnreadableAnswer({
      message: "Bluesky did not return a post URI.",
      stage: "publish",
    });
  }

  return { ok: true, postId: uri, postUrl: buildPostUrl(input.config, uri) };
}

/** Bluesky has no title field, so a title becomes the first line. */
function buildPostText(input: ProviderPublishInput): string {
  const trimmedTitle = input.title.trim();
  const trimmedBody = input.body.trim();
  if (!trimmedTitle) return trimmedBody;
  if (!trimmedBody) return trimmedTitle;
  return `${trimmedTitle}\n\n${trimmedBody}`;
}

function buildPostUrl(
  config: Record<string, unknown>,
  recordUri: string,
): string | null {
  const handle = typeof config.handle === "string" ? config.handle : null;
  const recordKey = recordUri.split("/").pop();
  if (!handle || !recordKey) return null;
  return `https://bsky.app/profile/${handle}/post/${recordKey}`;
}

type BlobUploadResult = { ok: true; blob: unknown } | ProviderPublishFailure;

async function uploadImageBlob(
  service: string,
  accessToken: string,
  mediaUrl: string,
  mimeType: string,
): Promise<BlobUploadResult> {
  const storedImage = await fetchStoredMedia(mediaUrl, BLUESKY_MAX_IMAGE_BYTES);
  if (!storedImage.ok) return storedImage;

  const uploadResult = await providerFetch(
    `${service}/xrpc/com.atproto.repo.uploadBlob`,
    {
      method: "POST",
      headers: {
        "Content-Type": mimeType,
        Authorization: `Bearer ${accessToken}`,
      },
      body: storedImage.media,
      timeoutMs: BLUESKY_TIMEOUT_MS,
    },
  );

  if (!uploadResult.ok) {
    return failProviderFetch({
      platform: "bluesky",
      stage: "prepare",
      fetchFailure: uploadResult,
    });
  }
  if (uploadResult.status !== 200) {
    return failHttpAnswer({
      platform: "bluesky",
      stage: "prepare",
      action: "Bluesky blob upload",
      httpStatus: uploadResult.status,
      bodyText: uploadResult.bodyText,
    });
  }

  const blob = parseJsonObject(uploadResult.bodyText)?.blob;
  if (!blob) {
    return failUnreadableAnswer({
      message: "Bluesky blob upload returned no blob ref.",
      stage: "prepare",
    });
  }

  return { ok: true, blob };
}

export const blueskyBehavior: ProviderBehavior = { connect, publish, refresh };
