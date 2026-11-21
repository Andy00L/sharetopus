import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";
import type { CreatedVia } from "@/db/schema";
import {
  POST_DUE_TARGET_COLUMNS,
  sendPostDueEvents,
} from "@/inngest/dispatch/sendPostDueEvents";
import type { PostChangeFailure } from "@/lib/types/postBatch";
import { checkRateLimit } from "../../rateLimit/checkRateLimit";

const RATE_LIMIT = 30;
const RATE_WINDOW_SECONDS = 60;

export type UpdateScheduledTimeBatchResult = {
  message: string;
  resetIn?: number;
} & (
  | {
      success: true;
      details: {
        total: number;
        succeeded: number;
        failed: number;
        resumedCount: number;
      };
    }
  | { success: false; failure: PostChangeFailure }
);

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
      return {
        success: false,
        failure: "invalid_request",
        message: "No post IDs provided.",
      };
    }

    const scheduledTime = new Date(newScheduledTime);
    if (isNaN(scheduledTime.getTime())) {
      return {
        success: false,
        failure: "invalid_request",
        message: "Invalid date format.",
      };
    }
    if (scheduledTime <= new Date()) {
      return {
        success: false,
        failure: "invalid_request",
        message: "Scheduled time must be in the future.",
      };
    }

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
        failure: rateCheck.reason === "limited" ? "rate_limited" : "unavailable",
        message: rateCheck.message,
        resetIn: rateCheck.resetIn,
      };
    }

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
        failure: "unavailable",
        message: "Could not load your posts. Please try again.",
      };
    }
    if (posts.length === 0) {
      return { success: false, failure: "not_found", message: "No posts found." };
    }

    const unauthorized = posts.filter(
      (post) => post.principal_id !== principalId,
    );
    if (unauthorized.length > 0) {
      return {
        success: false,
        failure: "not_found",
        message: `No post found for id(s): ${unauthorized.map((post) => post.id).join(", ")}.`,
      };
    }

    const reschedulable = posts.filter(
      (post) => post.status === "scheduled" || post.status === "cancelled",
    );
    if (reschedulable.length === 0) {
      return {
        success: false,
        failure: "not_eligible",
        message: "Only scheduled or cancelled posts can be rescheduled.",
      };
    }

    const cancelledIds = new Set(
      reschedulable
        .filter((post) => post.status === "cancelled")
        .map((post) => post.id),
    );

    const { data: movedRows, error: updateError } = await runQuery(
      db
        .update(scheduled_posts)
        .set({
          scheduled_at: scheduledTime.toISOString(),
          status: "scheduled",
          cancelled_by_sub_at: null,
        })
        .where(
          and(
            inArray(
              scheduled_posts.id,
              reschedulable.map((post) => post.id),
            ),
            eq(scheduled_posts.principal_id, principalId),
            inArray(scheduled_posts.status, ["scheduled", "cancelled"]),
          ),
        )
        .returning(POST_DUE_TARGET_COLUMNS),
    );

    if (updateError) {
      console.error(
        `[updateScheduledTimeBatch] [req=${requestId ?? "?"}] Update error:`,
        updateError.message,
      );
      return {
        success: false,
        failure: "internal",
        message: "Database error rescheduling posts.",
      };
    }
    if (movedRows.length === 0) {
      return {
        success: false,
        failure: "not_eligible",
        message: "Only scheduled or cancelled posts can be rescheduled.",
      };
    }

    await sendPostDueEvents(movedRows);

    const resumedCount = movedRows.filter((movedRow) =>
      cancelledIds.has(movedRow.id),
    ).length;

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
      message: `Rescheduled ${movedRows.length} post(s) to ${formattedDate}.`,
      details: {
        total: postIds.length,
        succeeded: movedRows.length,
        failed: postIds.length - movedRows.length,
        resumedCount,
      },
    };
  } catch (err) {
    console.error(
      `[updateScheduledTimeBatch] [req=${requestId ?? "?"}] Unexpected error:`,
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      failure: "internal",
      message: "Unexpected error rescheduling posts.",
    };
  }
}
