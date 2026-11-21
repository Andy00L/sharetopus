import { STORAGE_READ_TIMEOUT_MS } from "@/actions/server/data/storageRead";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";

export const PLATFORM_API_TIMEOUT_MS = 15_000;

export const PLATFORM_PUBLISH_TIMEOUT_MS = 30_000;

export const TOKEN_REFRESH_REQUEST_TIMEOUT_MS = 15_000;

export const REGISTRY_OAUTH_REQUEST_TIMEOUT_MS = 20_000;

export const BLUESKY_REQUEST_TIMEOUT_MS = 20_000;

// Pinterest (image_url pin) and Instagram (image container) download the image
// from our URL before they answer, and neither states a time limit. Instagram
// caps images at 8 MB and answers subcode 2207003 when its own download is too slow:
// https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
// https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/error-codes
export const PLATFORM_IMAGE_PULL_TIMEOUT_MS = 45_000;

export const PLATFORM_MEDIA_UPLOAD_TIMEOUT_MS = 240_000;

export const TOKEN_REFRESH_LOCK_TTL_MS = 45_000;

export const TOKEN_REFRESH_WAIT_DEADLINE_MS = TOKEN_REFRESH_LOCK_TTL_MS + 5_000;

const PUBLISH_STEP_BUDGET_MS = RUNTIME.minStepBudgetS * 1000;

const PUBLISH_STEP_DATABASE_RESERVE_MS = 10_000;

function deriveMediaTimeoutMs({
  otherStepRequestsMs,
}: {
  otherStepRequestsMs: readonly number[];
}): number {
  const otherRequestsTotalMs = otherStepRequestsMs.reduce(
    (totalMs, requestMs) => totalMs + requestMs,
    0,
  );
  return Math.min(
    PLATFORM_MEDIA_UPLOAD_TIMEOUT_MS,
    PUBLISH_STEP_BUDGET_MS -
      TOKEN_REFRESH_WAIT_DEADLINE_MS -
      PUBLISH_STEP_DATABASE_RESERVE_MS -
      otherRequestsTotalMs,
  );
}

export const LINKEDIN_MEDIA_UPLOAD_TIMEOUT_MS = deriveMediaTimeoutMs({
  otherStepRequestsMs: [STORAGE_READ_TIMEOUT_MS, PLATFORM_API_TIMEOUT_MS, PLATFORM_PUBLISH_TIMEOUT_MS],
});

export const YOUTUBE_MEDIA_UPLOAD_TIMEOUT_MS = deriveMediaTimeoutMs({
  otherStepRequestsMs: [STORAGE_READ_TIMEOUT_MS, PLATFORM_API_TIMEOUT_MS],
});

export const PINTEREST_VIDEO_UPLOAD_AND_PROCESSING_TIMEOUT_MS = deriveMediaTimeoutMs({
  otherStepRequestsMs: [PLATFORM_API_TIMEOUT_MS, PLATFORM_API_TIMEOUT_MS, PLATFORM_PUBLISH_TIMEOUT_MS],
});
