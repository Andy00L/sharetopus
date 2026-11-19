import "server-only";

import type { Blob } from "node:buffer";

import { fetch as undiciFetch } from "undici";

import { RUNTIME } from "@/lib/jobs/runtimeConfig";
import { describeNetworkError } from "@/lib/net/describeNetworkError";

const STORED_MEDIA_TIMEOUT_MS = 60_000;

const BYTES_PER_MB = 1024 * 1024;

export const STORED_MEDIA_MAX_BYTES = RUNTIME.maxVideoMB * BYTES_PER_MB;

export type StoredMediaResult =
  | { ok: true; media: Blob }
  | { ok: false; message: string };

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
      signal: AbortSignal.timeout(STORED_MEDIA_TIMEOUT_MS),
    });
    if (!mediaResponse.ok) {
      await mediaResponse.body?.cancel();
      return {
        ok: false,
        message: `Could not read the post media (HTTP ${mediaResponse.status}).`,
      };
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
    return {
      ok: false,
      message: `Could not read the post media: ${describeNetworkError(mediaError)}`,
    };
  }
}

function buildTooLargeResult(
  mediaBytes: number,
  maxBytes: number,
): StoredMediaResult {
  return {
    ok: false,
    message: `Media is ${Math.ceil(mediaBytes / 1024)}KB; this platform accepts up to ${Math.floor(maxBytes / 1024)}KB.`,
  };
}
