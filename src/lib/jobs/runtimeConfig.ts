import {
  DEFAULT_UPLOAD_LIMITS,
  TIER_UPLOAD_LIMITS,
} from "@/components/core/create/constants/uploadLimits";

const MAX_VIDEO_MB = Math.max(
  ...Object.values(TIER_UPLOAD_LIMITS).map((tierLimits) => tierLimits.video),
  DEFAULT_UPLOAD_LIMITS.video,
);

const NODE_OVERHEAD_MB = 100;

// Vercel's default function memory on Hobby and Pro is 2048 MB:
// https://vercel.com/docs/functions/limitations#memory-size-limits
const VERCEL_INSTANCE_MEMORY_MB = readPositiveInt(
  "VERCEL_INSTANCE_MEMORY_MB",
  2048,
);

const computedWorkerConcurrency = Math.max(
  1,
  Math.floor(VERCEL_INSTANCE_MEMORY_MB / (MAX_VIDEO_MB + NODE_OVERHEAD_MB)),
);

export const RUNTIME = {
  // Vercel Hobby with Fluid compute caps a function at 300 s:
  // https://vercel.com/docs/functions/limitations#max-duration
  maxDurationS: 300,
  minStepBudgetS: 290,
  workerConcurrency: computedWorkerConcurrency,
  maxVideoMB: MAX_VIDEO_MB,
  perAccountThrottlePerMinute: readPositiveInt(
    "PER_ACCOUNT_THROTTLE_PER_MIN",
    5
  ),
  maxRetries: readPositiveInt("WORKER_MAX_RETRIES", 3),
  dispatcherBatchSize: readPositiveInt("DISPATCHER_BATCH_SIZE", 200),
  signedUrlTtlS: readPositiveInt("SIGNED_URL_TTL_S", 300),

  // 60 x 60 s spans TikTok's one-hour URL download timeout
  // (video_pull_failed):
  // https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status
  tikTokPublishPollMaxAttempts: 60,
  tikTokPublishPollIntervalMs: 60_000,
} as const;

/**
 * Retry counts Inngest accepts on a function config.
 * sourceRef: node_modules/inngest/components/InngestFunction.d.ts:336
 */
const INNGEST_RETRY_VALUES = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
] as const;

export type InngestRetryCount = (typeof INNGEST_RETRY_VALUES)[number];

export function toInngestRetryCount(requested: number): InngestRetryCount {
  const clamped = Math.min(
    Math.max(Math.trunc(requested), 0),
    INNGEST_RETRY_VALUES.length - 1,
  );
  return INNGEST_RETRY_VALUES[clamped];
}

function readPositiveInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
