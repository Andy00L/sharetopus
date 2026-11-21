import "server-only";

import type { Blob } from "node:buffer";

import { fetch as undiciFetch } from "undici";

import { STORAGE_READ_TIMEOUT_MS } from "@/actions/server/data/storageRead";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";
import { describeNetworkError } from "@/lib/net/describeNetworkError";

import type { ProviderPublishFailure } from "../types";
import { failPublish, refusePublish } from "./publishFailure";

export const BYTES_PER_MB = 1024 * 1024;

export const STORED_MEDIA_MAX_BYTES = RUNTIME.maxVideoMB * BYTES_PER_MB;

export type StoredMediaResult = { ok: true; media: Blob } | ProviderPublishFailure;

/**
 * undici's fetch returns a node:buffer Blob, the Blob type providerFetch
 * takes as a body.
 */
export async function fetchStoredMedia(
  mediaUrl: string,
  maxBytes: number,
): Promise<StoredMediaResult> {
  try {
    const mediaResponse = await undiciFetch(mediaUrl, {
      signal: AbortSignal.timeout(STORAGE_READ_TIMEOUT_MS),
    });
    if (!mediaResponse.ok) {
      await mediaResponse.body?.cancel();
      return buildStorageFailure(
        `Could not read the post media (HTTP ${mediaResponse.status}).`,
      );
    }

    const declaredBytes = Number(mediaResponse.headers.get("content-length"));
    if (declaredBytes > maxBytes) {
      await mediaResponse.body?.cancel();
      return buildTooLargeResult(declaredBytes, maxBytes);
    }

    const media = await mediaResponse.blob();
    if (media.size > maxBytes) return buildTooLargeResult(media.size, maxBytes);
    return { ok: true, media };
  } catch (mediaError) {
    return buildStorageFailure(
      `Could not read the post media: ${describeNetworkError(mediaError)}`,
    );
  }
}

export async function readStoredMediaBytes(
  mediaUrl: string,
): Promise<{ ok: true; declaredBytes: number | null } | ProviderPublishFailure> {
  try {
    const mediaResponse = await undiciFetch(mediaUrl, {
      signal: AbortSignal.timeout(STORAGE_READ_TIMEOUT_MS),
    });
    await mediaResponse.body?.cancel();
    if (!mediaResponse.ok) {
      return buildStorageFailure(
        `Could not read the post media (HTTP ${mediaResponse.status}).`,
      );
    }
    const declaredBytes = Number(mediaResponse.headers.get("content-length"));
    return {
      ok: true,
      declaredBytes: Number.isFinite(declaredBytes) && declaredBytes > 0 ? declaredBytes : null,
    };
  } catch (mediaError) {
    return buildStorageFailure(
      `Could not read the post media: ${describeNetworkError(mediaError)}`,
    );
  }
}

function buildStorageFailure(message: string): ProviderPublishFailure {
  return failPublish({ message, reason: "transient", mayHavePublished: false });
}

function buildTooLargeResult(
  mediaBytes: number,
  maxBytes: number,
): ProviderPublishFailure {
  return refusePublish(
    `Media is ${Math.ceil(mediaBytes / 1024)}KB; this platform accepts up to ${Math.floor(maxBytes / 1024)}KB.`,
  );
}
