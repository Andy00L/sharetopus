"use client";

import { toast } from "sonner";
import type {
  PostStatusJob,
  PostStatusResponse,
} from "@/lib/types/postStatus";
import { isJobTerminal } from "@/lib/types/postStatus";

/**
 * Adaptive polling configuration. Fast phase covers the typical
 * direct-post path where most platforms finish in under a minute.
 * Slow phase covers Pinterest video and Instagram reel processing
 * which can take 30 to 45 seconds.
 *
 * Total worst-case wall-clock cap:
 *   60 fast attempts * 1s + 60 slow attempts * 2s = 180 seconds
 */
const FAST_PHASE_ATTEMPTS = 60;
const FAST_PHASE_INTERVAL_MS = 1000;
const SLOW_PHASE_ATTEMPTS = 60;
const SLOW_PHASE_INTERVAL_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function intervalFor(attempt: number): number {
  return attempt < FAST_PHASE_ATTEMPTS
    ? FAST_PHASE_INTERVAL_MS
    : SLOW_PHASE_INTERVAL_MS;
}

function platformDisplay(platform: string): string {
  if (!platform || platform === "unknown") return "the platform";
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

/**
 * Emits a toast for a single newly-terminal job. Tracks emitted
 * event_ids so each job toasts at most once across polling iterations.
 */
function emitToastForJob(job: PostStatusJob, toasted: Set<string>): void {
  if (toasted.has(job.event_id)) return;
  if (!isJobTerminal(job.status)) return;

  const name = platformDisplay(job.platform);
  if (job.status === "success") {
    toast.success(`Posted to ${name}`);
  } else {
    const reason = job.error_message?.trim() || "post failed";
    toast.error(`${name}: ${reason}`);
  }
  toasted.add(job.event_id);
}

/**
 * Summary toast after all jobs are terminal. Only shown for
 * multi-event runs to avoid noise on single-platform posts.
 */
function emitSummaryToast(jobs: PostStatusJob[]): void {
  if (jobs.length <= 1) return;
  const succeeded = jobs.filter((j) => j.status === "success").length;
  const failed = jobs.filter((j) => j.status === "failed").length;

  if (failed === 0) {
    toast.success(`All ${succeeded} posts succeeded`);
  } else if (succeeded === 0) {
    toast.error(`All ${failed} posts failed`);
  } else {
    toast.warning(`${succeeded} succeeded, ${failed} failed`);
  }
}

/**
 * Polls /api/posts/status until every event_id reaches a terminal
 * state or the configured cap is hit.
 *
 * Fetches FIRST on each iteration, sleeps AFTER. Per-event toasts
 * as each event becomes terminal, plus a summary at the end for
 * multi-event runs.
 */
export async function pollDirectPostStatus(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;

  const toasted = new Set<string>();
  const totalAttempts = FAST_PHASE_ATTEMPTS + SLOW_PHASE_ATTEMPTS;
  const query = eventIds.join(",");

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    try {
      const res = await fetch(
        `/api/posts/status?event_ids=${encodeURIComponent(query)}`,
        { cache: "no-store" },
      );

      if (res.ok) {
        const body = (await res.json()) as PostStatusResponse;
        if (body.success) {
          for (const job of body.jobs) {
            emitToastForJob(job, toasted);
          }
          if (body.allTerminal) {
            emitSummaryToast(body.jobs);
            return;
          }
        }
      }
    } catch (err) {
      console.warn(
        "[pollDirectPostStatus] Transient fetch error, continuing:",
        err instanceof Error ? err.message : err,
      );
    }

    await sleep(intervalFor(attempt));
  }

  toast.warning(
    "Posts are taking longer than expected. They will continue in the background.",
  );
}
