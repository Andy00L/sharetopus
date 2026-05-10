import {
  DEFAULT_UPLOAD_LIMITS,
  PRICE_ID_UPLOAD_LIMITS,
} from "@/components/core/create/constants/uploadLimits";

// Largest video upload any plan allows (in MB). Used to compute how
// many concurrent workers can run without exceeding the Vercel
// function memory ceiling.
const MAX_VIDEO_MB = Math.max(
  ...Object.values(PRICE_ID_UPLOAD_LIMITS).map((l) => l.video),
  DEFAULT_UPLOAD_LIMITS.video,
);

// Overhead per worker beyond the video buffer (V8 heap, Node runtime,
// multipart envelope, platform SDK objects, etc.).
const NODE_OVERHEAD_MB = 100;

// Vercel function memory ceiling. Defaults to 2048 MB (Hobby/Pro).
// Override via env var if the project uses a different setting.
const VERCEL_INSTANCE_MEMORY_MB = readPositiveInt(
  "VERCEL_INSTANCE_MEMORY_MB",
  2048,
);

// workerConcurrency self-adjusts: Pinterest video buffers up to
// MAX_VIDEO_MB. Worst case per worker = MAX_VIDEO_MB + Node overhead.
// We cap concurrency so concurrent workers don't OOM the Vercel
// function memory ceiling.
// At 250MB max video and 2048MB ceiling: floor(2048 / 350) = 5.
const computedWorkerConcurrency = Math.max(
  1,
  Math.floor(VERCEL_INSTANCE_MEMORY_MB / (MAX_VIDEO_MB + NODE_OVERHEAD_MB)),
);

/**
 * Operator-controlled runtime knobs. Set in Vercel env vars.
 * Defaults are safe for Vercel Hobby with Fluid Compute (300s ceiling).
 * On Pro: bump MAX_FILE_MB, POLL_WINDOW_S. workerConcurrency now
 * derives from MAX_VIDEO_MB automatically.
 *
 * MAX_DURATION_S must match the maxDuration export in
 * src/app/api/inngest/route.ts AND maxRuntime on the Inngest client.
 */
export const RUNTIME = {
  maxDurationS: readPositiveInt("MAX_DURATION_S", 300),
  workerConcurrency: computedWorkerConcurrency,
  maxVideoMB: MAX_VIDEO_MB,
  perAccountThrottlePerMinute: readPositiveInt(
    "PER_ACCOUNT_THROTTLE_PER_MIN",
    5
  ),
  maxFileMb: readPositiveInt("MAX_FILE_MB", 100),
  pollWindowS: readPositiveInt("POLL_WINDOW_S", 120),
  maxRetries: readPositiveInt("WORKER_MAX_RETRIES", 3),
  dispatcherBatchSize: readPositiveInt("DISPATCHER_BATCH_SIZE", 200),
  signedUrlTtlS: readPositiveInt("SIGNED_URL_TTL_S", 300),

  // TikTok publish status polling.
  // TikTok pulls media asynchronously after init returns publish_id.
  // We poll TikTok's status endpoint until terminal state to know when
  // the pull is done and the file can be released for cleanup.
  // Total ceiling = maxAttempts x intervalMs = 60 x 10s = 10 minutes.
  tikTokPublishPollMaxAttempts: 60,
  tikTokPublishPollIntervalMs: 10_000,

  // Direct-post status polling (FIX 26).
  // Client polls /api/posts/status to check Inngest run state.
  directPostStatusPollIntervalMs: readPositiveInt(
    "DIRECT_POST_POLL_INTERVAL_MS",
    1500
  ),
  directPostStatusPollMaxAttempts: readPositiveInt(
    "DIRECT_POST_POLL_MAX_ATTEMPTS",
    120
  ),
} as const;

function readPositiveInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
