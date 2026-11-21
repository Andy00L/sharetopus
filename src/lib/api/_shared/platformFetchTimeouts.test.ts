import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { RUNTIME } = await import("@/lib/jobs/runtimeConfig");
const {
  LINKEDIN_MEDIA_UPLOAD_TIMEOUT_MS,
  PINTEREST_VIDEO_UPLOAD_AND_PROCESSING_TIMEOUT_MS,
  YOUTUBE_MEDIA_UPLOAD_TIMEOUT_MS,
} = await import("./platformFetchTimeouts");

const SLOWEST_SUPPORTED_UPLOAD_MB_PER_S = 2.5;

describe("media upload timeouts derived from the publish step budget", () => {
  test("each upload window carries the largest allowed video at 20 Mbit/s", () => {
    const uploadWindowsMs = {
      linkedin: LINKEDIN_MEDIA_UPLOAD_TIMEOUT_MS,
      youtube: YOUTUBE_MEDIA_UPLOAD_TIMEOUT_MS,
      pinterest: PINTEREST_VIDEO_UPLOAD_AND_PROCESSING_TIMEOUT_MS,
    };
    for (const [platform, windowMs] of Object.entries(uploadWindowsMs)) {
      const carriedMegabytes = (windowMs / 1000) * SLOWEST_SUPPORTED_UPLOAD_MB_PER_S;
      expect({ platform, fits: carriedMegabytes >= RUNTIME.maxVideoMB }).toEqual({ platform, fits: true });
    }
  });
});
