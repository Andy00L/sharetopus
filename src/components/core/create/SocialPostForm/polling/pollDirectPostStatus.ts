"use client";

import { toast } from "sonner";
import { z } from "zod";
import type {
  PostStatusJob,
  PostStatusResponse,
} from "@/lib/types/postStatus";
import { isJobTerminal } from "@/lib/types/postStatus";

// 60 polls at 1 s, then 60 at 2 s for slow video processing: 180 s worst case.
const FAST_PHASE_ATTEMPTS = 60;
const FAST_PHASE_INTERVAL_MS = 1000;
const SLOW_PHASE_ATTEMPTS = 60;
const SLOW_PHASE_INTERVAL_MS = 2000;

/** Runtime mirror of PostStatusResponse; the annotation keeps it in step with the shared type. */
const PostStatusResponseSchema: z.ZodType<PostStatusResponse> = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    jobs: z.array(
      z.object({
        event_id: z.string(),
        status: z.enum(["pending", "success", "failed"]),
        platform: z.string(),
        error_message: z.string().nullable(),
      }),
    ),
    allTerminal: z.boolean(),
  }),
  z.object({ success: z.literal(false), message: z.string() }),
]);

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

/** Toasts a job once, when it first reaches a terminal state. */
function emitToastForJob(job: PostStatusJob, toasted: Set<string>): void {
  if (toasted.has(job.event_id)) return;
  if (!isJobTerminal(job.status)) return;

  const name = platformDisplay(job.platform);
  if (job.status === "success" && job.platform === "tiktok") {
    // Success here means TikTok accepted the post; it then processes it.
    // The Content Sharing Guidelines require telling the user so.
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

/** Summary toast once every job is terminal; skipped for single-job runs. */
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

/** Polls /api/posts/status until every event is terminal or 180 s pass, toasting each result. */
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
        const responseBody: unknown = await res.json();
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
