"use client";

import { toast } from "sonner";
import {
  isJobTerminal,
  PostStatusResponseSchema,
  type PostStatusJob,
} from "@/lib/types/postStatus";

const FAST_PHASE_ATTEMPTS = 60;
const FAST_PHASE_INTERVAL_MS = 1000;
const SLOW_PHASE_ATTEMPTS = 60;
const SLOW_PHASE_INTERVAL_MS = 2000;
const STATUS_REQUEST_TIMEOUT_MS = 10_000;

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

function emitToastForJob(job: PostStatusJob, toasted: Set<string>): void {
  if (toasted.has(job.event_id)) return;
  if (!isJobTerminal(job.status)) return;

  const name = platformDisplay(job.platform);
  if (job.status === "success" && job.platform === "tiktok") {
    // TikTok Content Sharing Guidelines, Required UX Implementation 5d: tell the
    // user the post may take a few minutes to process and show on the profile.
    toast.success(
      "Sent to TikTok. It may take a few minutes for your post to process and be visible on your profile.",
    );
  } else if (job.status === "success") {
    toast.success(`Posted to ${name}`);
  } else {
    const reason = job.error_message?.trim() || "post failed";
    toast.error(`${name}: ${reason}`);
  }
  toasted.add(job.event_id);
}

function emitSummaryToast(jobs: PostStatusJob[]): void {
  if (jobs.length <= 1) return;
  const succeeded = jobs.filter((job) => job.status === "success").length;
  const failed = jobs.filter((job) => job.status === "failed").length;

  if (failed === 0) {
    toast.success(`All ${succeeded} posts succeeded`);
  } else if (succeeded === 0) {
    toast.error(`All ${failed} posts failed`);
  } else {
    toast.warning(`${succeeded} succeeded, ${failed} failed`);
  }
}

export async function pollDirectPostStatus(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;

  const toasted = new Set<string>();
  const totalAttempts = FAST_PHASE_ATTEMPTS + SLOW_PHASE_ATTEMPTS;
  const query = eventIds.join(",");

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    try {
      const response = await fetch(
        `/api/posts/status?event_ids=${encodeURIComponent(query)}`,
        { cache: "no-store", signal: AbortSignal.timeout(STATUS_REQUEST_TIMEOUT_MS) },
      );

      if (response.ok) {
        const responseBody: unknown = await response.json();
        const parsedResponse = PostStatusResponseSchema.safeParse(responseBody);
        const body = parsedResponse.success ? parsedResponse.data : null;
        if (body?.success) {
          for (const job of body.jobs) {
            emitToastForJob(job, toasted);
          }
          if (body.allTerminal) {
            emitSummaryToast(body.jobs);
            return;
          }
        }
      }
    } catch (fetchError) {
      console.warn(
        "[pollDirectPostStatus] Transient fetch error, continuing:",
        fetchError instanceof Error ? fetchError.message : fetchError,
      );
    }

    await sleep(intervalFor(attempt));
  }

  toast.warning(
    "Posts are taking longer than expected. They will continue in the background.",
  );
}
