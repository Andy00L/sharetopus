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
 * Bluesky (AT Protocol) provider.
 *
 * Auth is an app password exchanged for a session, so a user can connect
 * without any app registration on our side. createSession returns a short
 * lived accessJwt plus a refreshJwt; the access token is what we post with
 * and refreshSession renews it.
 *
 * The service URL is a connect field because a user may run their own PDS.
 * That makes it untrusted input, so every call goes through providerFetch
 * (DNS validated, IP pinned, redirects refused).
 *
 * sourceRef: atproto XRPC (com.atproto.server.createSession,
 * com.atproto.repo.uploadBlob, com.atproto.repo.createRecord).
 */

/** Public Bluesky PDS. Used when the user leaves the service field blank. */
const DEFAULT_BLUESKY_SERVICE = "https://bsky.social";

/** Bluesky sessions are short lived; renew well before the hour is out. */
const BLUESKY_SESSION_TTL_SECONDS = 60 * 60;

/** Per-request ceiling for XRPC calls. */
const BLUESKY_TIMEOUT_MS = 20_000;

/** Bluesky rejects blobs over roughly 1MB on the image path. */
const BLUESKY_MAX_IMAGE_BYTES = 1_000_000;

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
    // The DID and service are needed on every later call; the app password
    // is deliberately NOT stored, the refresh token replaces it.
    config: { service, did, handle },
  };
}

async function refresh(refreshToken: string): Promise<ProviderConnectResult> {
  // refreshSession authenticates with the refresh JWT itself, and it is
  // bound to the PDS that issued it. The default service covers the hosted
  // case; a self-hosted PDS re-authenticates through connect instead.
  const refreshResult = await providerFetch(
    `${DEFAULT_BLUESKY_SERVICE}/xrpc/com.atproto.server.refreshSession`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${refreshToken}` },
      timeoutMs: BLUESKY_TIMEOUT_MS,
    },
  );

  if (!refreshResult.ok) {
    return { ok: false, message: refreshResult.message };
  }
  if (refreshResult.status !== 200) {
    return {
      ok: false,
      message: `Bluesky session refresh failed (HTTP ${refreshResult.status}). Reconnect the account.`,
    };
  }

  const session = parseJsonBody(refreshResult.bodyText);
  const accessJwt = readStringField(session, "accessJwt");
  const nextRefreshJwt = readStringField(session, "refreshJwt");
  const did = readStringField(session, "did");
  const handle = readStringField(session, "handle");

  if (!accessJwt || !did) {
    return {
      ok: false,
      message: "Bluesky refresh response was missing accessJwt or did.",
    };
  }

  return {
    ok: true,
    accessToken: accessJwt,
    refreshToken: nextRefreshJwt,
    expiresIn: BLUESKY_SESSION_TTL_SECONDS,
    identity: {
      accountIdentifier: did,
      displayName: handle,
      username: handle,
      avatarUrl: null,
    },
    config: { service: DEFAULT_BLUESKY_SERVICE, did, handle },
  };
}

async function publish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const service = resolveServiceUrl(input.config);
  const did = typeof input.config.did === "string" ? input.config.did : null;
  if (!did) {
    return { ok: false, message: "Stored Bluesky account is missing its DID." };
  }

  const postText = buildPostText(input);

  // Image posts need the bytes uploaded as a blob first; the returned blob
  // ref is embedded in the record. Text posts skip this entirely.
  let embed: Record<string, unknown> | null = null;
  if (input.mediaType === "image" && input.mediaUrl) {
    const blobResult = await uploadImageBlob(
      service,
      input.accessToken,
      input.mediaUrl,
      input.mediaMimeType,
    );
    if (!blobResult.ok) {
      return { ok: false, message: blobResult.message };
    }
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
    return { ok: false, message: createResult.message };
  }
  if (createResult.status !== 200) {
    // Surface the status so the worker's classifier can tell a 429 from a
    // 401 and decide whether a retry is worth attempting.
    return {
      ok: false,
      message: `Bluesky createRecord failed (${createResult.status}): ${createResult.bodyText.slice(0, 300)}`,
    };
  }

  const created = parseJsonBody(createResult.bodyText);
  const uri = readStringField(created, "uri");
  if (!uri) {
    return { ok: false, message: "Bluesky did not return a post URI." };
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

/**
 * Converts an at:// record URI into the browsable bsky.app permalink.
 * Returns null when the handle is unknown rather than guessing a URL.
 */
function buildPostUrl(
  config: Record<string, unknown>,
  recordUri: string,
): string | null {
  const handle = typeof config.handle === "string" ? config.handle : null;
  const recordKey = recordUri.split("/").pop();
  if (!handle || !recordKey) return null;
  return `https://bsky.app/profile/${handle}/post/${recordKey}`;
}

type BlobUploadResult =
  | { ok: true; blob: unknown }
  | { ok: false; message: string };

/**
 * Fetches our own signed media URL and uploads the bytes to the PDS.
 *
 * The media URL is minted by us (Supabase signed URL), not supplied by the
 * user, so it does not need the SSRF guard; the PDS call does and gets it.
 */
async function uploadImageBlob(
  service: string,
  accessToken: string,
  mediaUrl: string,
  mimeType: string,
): Promise<BlobUploadResult> {
  let imageBytes: Uint8Array;
  try {
    const mediaResponse = await fetch(mediaUrl);
    if (!mediaResponse.ok) {
      return {
        ok: false,
        message: `Could not read the post media (HTTP ${mediaResponse.status}).`,
      };
    }
    imageBytes = new Uint8Array(await mediaResponse.arrayBuffer());
  } catch (mediaError) {
    return {
      ok: false,
      message: `Could not read the post media: ${
        mediaError instanceof Error ? mediaError.message : "unknown error"
      }`,
    };
  }

  if (imageBytes.byteLength > BLUESKY_MAX_IMAGE_BYTES) {
    return {
      ok: false,
      message: `Image is ${Math.round(imageBytes.byteLength / 1024)}KB; Bluesky accepts up to ${
        BLUESKY_MAX_IMAGE_BYTES / 1000
      }KB.`,
    };
  }

  const uploadResult = await providerFetch(
    `${service}/xrpc/com.atproto.repo.uploadBlob`,
    {
      method: "POST",
      headers: {
        "Content-Type": mimeType,
        Authorization: `Bearer ${accessToken}`,
      },
      body: imageBytes,
      timeoutMs: BLUESKY_TIMEOUT_MS,
    },
  );

  if (!uploadResult.ok) return { ok: false, message: uploadResult.message };
  if (uploadResult.status !== 200) {
    return {
      ok: false,
      message: `Bluesky blob upload failed (${uploadResult.status}).`,
    };
  }

  const uploaded = parseJsonBody(uploadResult.bodyText);
  if (!uploaded || typeof uploaded !== "object") {
    return { ok: false, message: "Bluesky blob upload returned no JSON." };
  }
  const blob = (uploaded as Record<string, unknown>).blob;
  if (!blob) {
    return { ok: false, message: "Bluesky blob upload returned no blob ref." };
  }

  return { ok: true, blob };
}

export const blueskyBehavior: ProviderBehavior = { connect, publish, refresh };
