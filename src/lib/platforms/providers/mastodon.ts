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
 * Mastodon provider. Covers mastodon.social and every other instance,
 * including self-hosted ones, because the instance URL is a connect field.
 *
 * The user creates an application in their own instance settings and pastes
 * the resulting access token, so nothing needs registering on our side. The
 * token does not expire, which is why this provider declares no refresh.
 *
 * The instance URL is untrusted input and every call goes through
 * providerFetch (DNS validated, IP pinned, redirects refused).
 *
 * sourceRef: docs.joinmastodon.org REST API (accounts/verify_credentials,
 * v2/media, statuses).
 */

const MASTODON_TIMEOUT_MS = 20_000;

/** Media upload can transcode video, so it gets a longer ceiling. */
const MASTODON_MEDIA_TIMEOUT_MS = 60_000;

function normalizeInstanceUrl(rawInstanceUrl: string): string {
  return rawInstanceUrl.trim().replace(/\/+$/, "");
}

function readInstanceUrl(config: Record<string, unknown>): string | null {
  const instanceUrl = config.instanceUrl;
  if (typeof instanceUrl !== "string" || instanceUrl.trim().length === 0) {
    return null;
  }
  return normalizeInstanceUrl(instanceUrl);
}

async function connect(
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "credentials") {
    return { ok: false, message: "Mastodon connects with an access token." };
  }

  const instanceUrl = normalizeInstanceUrl(input.values.instanceUrl ?? "");
  const accessToken = (input.values.accessToken ?? "").trim();

  if (!instanceUrl || !accessToken) {
    return {
      ok: false,
      message: "Instance URL and access token are both required.",
    };
  }

  // verify_credentials both proves the token works and gives us the
  // account identity in one call.
  const verifyResult = await providerFetch(
    `${instanceUrl}/api/v1/accounts/verify_credentials`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      timeoutMs: MASTODON_TIMEOUT_MS,
    },
  );

  if (!verifyResult.ok) return { ok: false, message: verifyResult.message };
  if (verifyResult.status === 401) {
    return {
      ok: false,
      message: "Mastodon rejected the access token. Check it was copied in full.",
    };
  }
  if (verifyResult.status !== 200) {
    return {
      ok: false,
      message: `Mastodon returned HTTP ${verifyResult.status} while verifying the token.`,
    };
  }

  const account = parseJsonBody(verifyResult.bodyText);
  const accountId = readStringField(account, "id");
  if (!accountId) {
    return {
      ok: false,
      message: "Mastodon did not return an account id for this token.",
    };
  }

  return {
    ok: true,
    accessToken,
    refreshToken: null,
    // Mastodon application tokens do not expire; null keeps ensureValidToken
    // from ever trying to refresh one.
    expiresIn: null,
    identity: {
      accountIdentifier: accountId,
      displayName: readStringField(account, "display_name"),
      username: readStringField(account, "username"),
      avatarUrl: readStringField(account, "avatar"),
    },
    config: { instanceUrl },
  };
}

async function publish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const instanceUrl = readInstanceUrl(input.config);
  if (!instanceUrl) {
    return {
      ok: false,
      message: "Stored Mastodon account is missing its instance URL.",
    };
  }

  const statusText = buildStatusText(input);

  const mediaIds: string[] = [];
  if (input.mediaUrl && input.mediaType !== "text") {
    const uploadResult = await uploadMedia(
      instanceUrl,
      input.accessToken,
      input.mediaUrl,
      input.fileName,
      input.mediaMimeType,
    );
    if (!uploadResult.ok) return { ok: false, message: uploadResult.message };
    mediaIds.push(uploadResult.mediaId);
  }

  const statusPayload: Record<string, unknown> = { status: statusText };
  if (mediaIds.length > 0) statusPayload.media_ids = mediaIds;

  const postResult = await providerFetch(`${instanceUrl}/api/v1/statuses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.accessToken}`,
      // Mastodon dedupes identical requests carrying the same idempotency
      // key for roughly an hour, which turns a worker retry into a no-op
      // instead of a duplicate toot.
      "Idempotency-Key": `${input.accountIdentifier}:${hashForIdempotency(statusText)}`,
    },
    body: JSON.stringify(statusPayload),
    timeoutMs: MASTODON_TIMEOUT_MS,
  });

  if (!postResult.ok) return { ok: false, message: postResult.message };
  if (postResult.status !== 200) {
    return {
      ok: false,
      message: `Mastodon post failed (${postResult.status}): ${postResult.bodyText.slice(0, 300)}`,
    };
  }

  const created = parseJsonBody(postResult.bodyText);
  const statusId = readStringField(created, "id");
  if (!statusId) {
    return { ok: false, message: "Mastodon did not return a status id." };
  }

  return {
    ok: true,
    postId: statusId,
    postUrl: readStringField(created, "url"),
  };
}

/** Mastodon has no title field, so a title becomes the first line. */
function buildStatusText(input: ProviderPublishInput): string {
  const trimmedTitle = input.title.trim();
  const trimmedBody = input.body.trim();
  if (!trimmedTitle) return trimmedBody;
  if (!trimmedBody) return trimmedTitle;
  return `${trimmedTitle}\n\n${trimmedBody}`;
}

/**
 * Stable short key for the Idempotency-Key header. Not a security value:
 * it only needs to be identical across retries of the same post and
 * different across different posts.
 */
function hashForIdempotency(statusText: string): string {
  let accumulator = 0;
  for (let index = 0; index < statusText.length; index++) {
    accumulator = (accumulator * 31 + statusText.charCodeAt(index)) | 0;
  }
  return Math.abs(accumulator).toString(36);
}

type MediaUploadResult =
  | { ok: true; mediaId: string }
  | { ok: false; message: string };

/**
 * Uploads media to the instance. Our own signed URL supplies the bytes, so
 * that read needs no SSRF guard; the instance call gets one.
 */
async function uploadMedia(
  instanceUrl: string,
  accessToken: string,
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

  const formBoundary = `----sharetopus${Math.abs(Date.now() | 0).toString(36)}`;
  const preamble =
    `--${formBoundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;
  const epilogue = `\r\n--${formBoundary}--\r\n`;

  const multipartBody = Buffer.concat([
    Buffer.from(preamble, "utf-8"),
    Buffer.from(mediaBytes),
    Buffer.from(epilogue, "utf-8"),
  ]);

  const uploadResult = await providerFetch(`${instanceUrl}/api/v2/media`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${formBoundary}`,
      Authorization: `Bearer ${accessToken}`,
    },
    body: new Uint8Array(multipartBody),
    timeoutMs: MASTODON_MEDIA_TIMEOUT_MS,
  });

  if (!uploadResult.ok) return { ok: false, message: uploadResult.message };

  // v2/media answers 202 while it is still processing; the id is usable in
  // a status immediately, so both 200 and 202 are success here.
  if (uploadResult.status !== 200 && uploadResult.status !== 202) {
    return {
      ok: false,
      message: `Mastodon media upload failed (${uploadResult.status}).`,
    };
  }

  const uploaded = parseJsonBody(uploadResult.bodyText);
  const mediaId = readStringField(uploaded, "id");
  if (!mediaId) {
    return { ok: false, message: "Mastodon media upload returned no id." };
  }

  return { ok: true, mediaId };
}

export const mastodonBehavior: ProviderBehavior = { connect, publish };
