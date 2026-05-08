/**
 * Operator-controlled runtime knobs. Set in Vercel env vars.
 * Defaults are safe for Vercel Hobby with Fluid Compute (300s ceiling).
 * On Pro: bump WORKER_CONCURRENCY, MAX_FILE_MB, POLL_WINDOW_S.
 *
 * MAX_DURATION_S must match the maxDuration export in
 * src/app/api/inngest/route.ts AND maxRuntime on the Inngest client.
 */
export const RUNTIME = {
  maxDurationS: readPositiveInt("MAX_DURATION_S", 300),
  workerConcurrency: readPositiveInt("WORKER_CONCURRENCY", 5),
  perAccountThrottlePerMinute: readPositiveInt(
    "PER_ACCOUNT_THROTTLE_PER_MIN",
    5
  ),
  maxFileMb: readPositiveInt("MAX_FILE_MB", 100),
  pollWindowS: readPositiveInt("POLL_WINDOW_S", 120),
  maxRetries: readPositiveInt("WORKER_MAX_RETRIES", 3),
  dispatcherBatchSize: readPositiveInt("DISPATCHER_BATCH_SIZE", 200),
  signedUrlTtlS: readPositiveInt("SIGNED_URL_TTL_S", 300),
} as const;

function readPositiveInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
