import "server-only";

import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { Blob } from "node:buffer";

import { FormData } from "undici";

import type {
  ProviderBehavior,
  ProviderConnectInput,
  ProviderConnectResult,
  ProviderPublishFailure,
  ProviderPublishInput,
  ProviderPublishResult,
} from "./types";
import {
  parseJsonBody,
  providerFetch,
  readStringField,
} from "./_shared/providerFetch";
import {
  fetchStoredMedia,
  STORED_MEDIA_MAX_BYTES,
} from "./_shared/fetchStoredMedia";
import {
  failHttpAnswer,
  failProviderFetch,
  failPublish,
  failUnreadableAnswer,
  refusePublish,
} from "./_shared/publishFailure";

/**
 * The token does not expire, which is why this provider declares no refresh.
 *
 * sourceRef: docs.joinmastodon.org REST API (accounts/verify_credentials,
 * v2/media, statuses).
 */

const MASTODON_TIMEOUT_MS = 20_000;

const MASTODON_MEDIA_TIMEOUT_MS = 60_000;

const MEDIA_PROCESSING_POLL_INTERVAL_MS = 2_000;

const MEDIA_PROCESSING_DEADLINE_MS = 90_000;

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
    return refusePublish("Stored Mastodon account is missing its instance URL.");
  }

  const statusText = buildStatusText(input);

  const mediaIds: string[] = [];
  if (input.mediaUrl && input.postType !== "text") {
    const uploadResult = await uploadMedia(
      instanceUrl,
      input.accessToken,
      input.mediaUrl,
      input.fileName,
      input.mediaMimeType,
    );
    if (!uploadResult.ok) return uploadResult;
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
      "Idempotency-Key": buildIdempotencyKey(input, statusText),
    },
    body: JSON.stringify(statusPayload),
    timeoutMs: MASTODON_TIMEOUT_MS,
  });

  if (!postResult.ok) {
    return failProviderFetch({
      platform: "mastodon",
      stage: "publish",
      fetchFailure: postResult,
    });
  }
  if (postResult.status !== 200) {
    return failHttpAnswer({
      platform: "mastodon",
      stage: "publish",
      action: "Mastodon post",
      httpStatus: postResult.status,
      bodyText: postResult.bodyText,
    });
  }

  const created = parseJsonBody(postResult.bodyText);
  const statusId = readStringField(created, "id");
  if (!statusId) {
    return failUnreadableAnswer({
      message: "Mastodon did not return a status id.",
      stage: "publish",
    });
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

function buildIdempotencyKey(
  input: Pick<ProviderPublishInput, "accountIdentifier" | "idempotencyKey" | "postType" | "fileName">,
  statusText: string,
): string {
  if (input.idempotencyKey) {
    return `${input.accountIdentifier}:post:${input.idempotencyKey}`;
  }
  const contentHash = createHash("sha256")
    .update(JSON.stringify([statusText, input.postType, input.fileName]))
    .digest("hex");
  return `${input.accountIdentifier}:content:${contentHash}`;
}

type MediaUploadResult = { ok: true; mediaId: string } | ProviderPublishFailure;

async function uploadMedia(
  instanceUrl: string,
  accessToken: string,
  mediaUrl: string,
  fileName: string,
  mimeType: string,
): Promise<MediaUploadResult> {
  const storedMedia = await fetchStoredMedia(mediaUrl, STORED_MEDIA_MAX_BYTES);
  if (!storedMedia.ok) return storedMedia;

  const uploadForm = new FormData();
  uploadForm.append(
    "file",
    new Blob([storedMedia.media], { type: mimeType }),
    fileName,
  );

  const uploadResult = await providerFetch(`${instanceUrl}/api/v2/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: uploadForm,
    timeoutMs: MASTODON_MEDIA_TIMEOUT_MS,
  });

  if (!uploadResult.ok) {
    return failProviderFetch({
      platform: "mastodon",
      stage: "prepare",
      fetchFailure: uploadResult,
    });
  }
  if (uploadResult.status !== 200 && uploadResult.status !== 202) {
    return failHttpAnswer({
      platform: "mastodon",
      stage: "prepare",
      action: "Mastodon media upload",
      httpStatus: uploadResult.status,
      bodyText: uploadResult.bodyText,
    });
  }

  const uploaded = parseJsonBody(uploadResult.bodyText);
  const mediaId = readStringField(uploaded, "id");
  if (!mediaId) {
    return failUnreadableAnswer({
      message: "Mastodon media upload returned no id.",
      stage: "prepare",
    });
  }

  // 202 means the file is still processing, and a status that attaches
  // unprocessed media is refused. sourceRef: docs.joinmastodon.org
  // methods/media (POST v2/media 202, GET v1/media/:id 200 vs 206).
  if (uploadResult.status === 202) {
    const processed = await waitForProcessedMedia(instanceUrl, accessToken, mediaId);
    if (!processed.ok) return processed;
  }

  return { ok: true, mediaId };
}

async function waitForProcessedMedia(
  instanceUrl: string,
  accessToken: string,
  mediaId: string,
): Promise<{ ok: true } | ProviderPublishFailure> {
  const deadlineMs = Date.now() + MEDIA_PROCESSING_DEADLINE_MS;
  while (Date.now() < deadlineMs) {
    await sleep(MEDIA_PROCESSING_POLL_INTERVAL_MS);
    const mediaStatus = await providerFetch(
      `${instanceUrl}/api/v1/media/${encodeURIComponent(mediaId)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        timeoutMs: MASTODON_TIMEOUT_MS,
      },
    );
    if (!mediaStatus.ok) {
      return failProviderFetch({
        platform: "mastodon",
        stage: "prepare",
        fetchFailure: mediaStatus,
      });
    }
    if (mediaStatus.status === 200) return { ok: true };
    if (mediaStatus.status !== 206) {
      return failHttpAnswer({
        platform: "mastodon",
        stage: "prepare",
        action: "Mastodon media processing",
        httpStatus: mediaStatus.status,
        bodyText: mediaStatus.bodyText,
      });
    }
  }
  return failPublish({
    message: `Mastodon was still processing the media after ${MEDIA_PROCESSING_DEADLINE_MS / 1000} seconds.`,
    reason: "transient",
    mayHavePublished: false,
  });
}

export const mastodonBehavior: ProviderBehavior = { connect, publish };
