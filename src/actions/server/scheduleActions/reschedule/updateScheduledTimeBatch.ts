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
import { RESCHEDULE_POST_BATCH_RATE_LIMIT } from "@/actions/server/rateLimit/rateLimitRules";
import {
  checkPostChangeRules,
  POST_CHANGE_ELIGIBLE_STATUSES,
} from "../preflightScheduledPostChange";
import { checkAccessToRevivePosts } from "../resume/_shared/checkAccessToRevivePosts";

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
    const rateCheck = await checkRateLimit({
      operation: rateLimitScope,
      identifier: principalId,
      rule: RESCHEDULE_POST_BATCH_RATE_LIMIT,
    });
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
          created_via: scheduled_posts.created_via,
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
    const rules = checkPostChangeRules({
      posts,
      principalId,
      eligibleStatuses: POST_CHANGE_ELIGIBLE_STATUSES.reschedule,
    });
    if (!rules.ok) {
      switch (rules.violation) {
        case "not_found":
          return { success: false, failure: "not_found", message: "No posts found." };
        case "not_owned":
          return {
            success: false,
            failure: "not_found",
            message: `No post found for id(s): ${rules.foreignPostIds.join(", ")}.`,
          };
        case "not_eligible":
          return {
            success: false,
            failure: "not_eligible",
            message: "Only scheduled or cancelled posts can be rescheduled.",
          };
        default: {
          const unhandledViolation: never = rules;
          return unhandledViolation;
        }
      }
    }
    const reschedulable = rules.eligiblePosts;
    const cancelledPosts = reschedulable.filter((post) => post.status === "cancelled");

    const reviveAccess = await checkAccessToRevivePosts({
      principalId,
      revivedPosts: cancelledPosts,
    });
    if (!reviveAccess.ok) {
      console.warn(
        `[updateScheduledTimeBatch] [req=${requestId ?? "?"}] Refused for ${principalId}: ${reviveAccess.failure}`,
      );
      return {
        success: false,
        failure: reviveAccess.failure === "unavailable" ? "unavailable" : "access_required",
        message: reviveAccess.message,
      };
    }

    const cancelledIds = new Set(cancelledPosts.map((post) => post.id));

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
