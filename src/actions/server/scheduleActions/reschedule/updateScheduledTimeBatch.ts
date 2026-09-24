import "server-only";

import { inArray } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";
import type { CreatedVia } from "@/lib/types/database.types";
import { checkRateLimit } from "../../rateLimit/checkRateLimit";

const RATE_LIMIT = 30;
const RATE_WINDOW_SECONDS = 60;

export type UpdateScheduledTimeBatchResult = {
  success: boolean;
  message: string;
  resetIn?: number;
  details?: {
    total: number;
    succeeded: number;
    failed: number;
    resumedCount: number;
  };
};

/**
 * Reschedules N posts to a new time. Shared core for web/MCP/x402.
 *
 * **Authentication:** Does not call Clerk. Caller must validate `principalId`.
 * **Rate limiting:** 30 calls per 60s per source.
 * **Tables:** scheduled_posts (read + update).
 *
 * Cancelled posts get auto-resumed (status -> scheduled) along with the
 * time update. Posts in terminal states (posted, failed) are skipped.
 *
 * @param postIds - Post IDs to reschedule
 * @param newScheduledTime - New datetime (must be in the future)
 * @param principalId - Owner (caller-validated)
 * @param source - Drives rate-limit scope
 */
export async function updateScheduledTimeBatch(
  postIds: string[],
  newScheduledTime: string | Date,
  principalId: string,
  source: CreatedVia,
  requestId?: string | null,
): Promise<UpdateScheduledTimeBatchResult> {
  console.log(
    `[updateScheduledTimeBatch] [req=${requestId ?? "?"}] Starting from source="${source}" for principal=${principalId}, ${postIds?.length ?? 0} post(s)`,
  );

  try {
    if (!postIds || postIds.length === 0) {
      return { success: false, message: "No post IDs provided." };
    }

    const scheduledTime = new Date(newScheduledTime);
    if (isNaN(scheduledTime.getTime())) {
      return { success: false, message: "Invalid date format." };
    }
    if (scheduledTime <= new Date()) {
      return {
        success: false,
        message: "Scheduled time must be in the future.",
      };
    }

    // Rate limit (anti-spam)
    const rateLimitScope = `${source}_update_scheduled_time_batch`;
    const rateCheck = await checkRateLimit(
      rateLimitScope,
      principalId,
      RATE_LIMIT,
      RATE_WINDOW_SECONDS,
    );
    if (!rateCheck.success) {
      return {
        success: false,
        message: "Too many reschedule requests. Please try again later.",
        resetIn: rateCheck.resetIn,
      };
    }

    // Fetch + ownership check (single query)
    const { data: posts, error: fetchError } = await runQuery(
      db
        .select({
          id: scheduled_posts.id,
          principal_id: scheduled_posts.principal_id,
          status: scheduled_posts.status,
        })
        .from(scheduled_posts)
        .where(inArray(scheduled_posts.id, postIds)),
    );

    if (fetchError) {
      console.error(
        `[updateScheduledTimeBatch] [req=${requestId ?? "?"}] Fetch error:`,
        fetchError.message,
      );
      return {
        success: false,
        message: `Failed to fetch posts: ${fetchError.message}`,
      };
    }
    if (posts.length === 0) {
      return { success: false, message: "No posts found." };
    }

    const unauthorized = posts.filter(
      (post) => post.principal_id !== principalId,
    );
    if (unauthorized.length > 0) {
      return { success: false, message: "You do not own some of these posts." };
    }

    const reschedulable = posts.filter(
      (post) => post.status === "scheduled" || post.status === "cancelled",
    );
    if (reschedulable.length === 0) {
      return { success: false, message: "No posts in a reschedulable state." };
    }

    const scheduledIds = reschedulable
      .filter((post) => post.status === "scheduled")
      .map((post) => post.id);
    const cancelledIds = reschedulable
      .filter((post) => post.status === "cancelled")
      .map((post) => post.id);

    let ok = true;

    if (scheduledIds.length > 0) {
      const { error } = await runQuery(
        db
          .update(scheduled_posts)
          .set({ scheduled_at: scheduledTime.toISOString() })
          .where(inArray(scheduled_posts.id, scheduledIds)),
      );
      if (error) {
        console.error(
          `[updateScheduledTimeBatch] [req=${requestId ?? "?"}] Update scheduled error:`,
          error.message,
        );
        ok = false;
      }
    }

    if (cancelledIds.length > 0) {
      const { error } = await runQuery(
        db
          .update(scheduled_posts)
          .set({
            scheduled_at: scheduledTime.toISOString(),
            status: "scheduled",
          })
          .where(inArray(scheduled_posts.id, cancelledIds)),
      );
      if (error) {
        console.error(
          `[updateScheduledTimeBatch] [req=${requestId ?? "?"}] Update cancelled error:`,
          error.message,
        );
        ok = false;
      }
    }

    if (!ok) {
      return {
        success: false,
        message: "Database error rescheduling posts.",
      };
    }

    const formattedDate = scheduledTime.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    });

    return {
      success: true,
      message: `Rescheduled ${reschedulable.length} post(s) to ${formattedDate}.`,
      details: {
        total: postIds.length,
        succeeded: reschedulable.length,
        failed: postIds.length - reschedulable.length,
        resumedCount: cancelledIds.length,
      },
    };
  } catch (err) {
    console.error(
      `[updateScheduledTimeBatch] [req=${requestId ?? "?"}] Unexpected error:`,
      err instanceof Error ? err.message : err,
    );
    return { success: false, message: "Unexpected error rescheduling posts." };
  }
}
