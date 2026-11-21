import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";
import type { CreatedVia } from "@/db/schema";
import type { PostChangeFailure } from "@/lib/types/postBatch";
import { checkRateLimit } from "../../rateLimit/checkRateLimit";
import { CANCEL_POST_BATCH_RATE_LIMIT } from "@/actions/server/rateLimit/rateLimitRules";
import {
  checkPostChangeRules,
  POST_CHANGE_ELIGIBLE_STATUSES,
} from "../preflightScheduledPostChange";

export type CancelScheduledPostBatchResult = {
  message: string;
  resetIn?: number;
} & (
  | {
      success: true;
      details: { total: number; succeeded: number; failed: number };
    }
  | { success: false; failure: PostChangeFailure }
);

export async function cancelScheduledPostBatch(
  postIds: string[],
  principalId: string,
  source: CreatedVia,
  requestId?: string | null,
): Promise<CancelScheduledPostBatchResult> {
  console.log(
    `[cancelScheduledPostBatch] [req=${requestId ?? "?"}] Starting from source="${source}" for principal=${principalId}, ${postIds?.length ?? 0} post(s) requested`,
  );
  try {
    if (!postIds || postIds.length === 0) {
      return {
        success: false,
        failure: "invalid_request",
        message: "No post IDs provided.",
      };
    }

    const rateLimitScope = `${source}_cancel_scheduled_posts`;
    const rateCheck = await checkRateLimit({
      operation: rateLimitScope,
      identifier: principalId,
      rule: CANCEL_POST_BATCH_RATE_LIMIT,
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
        })
        .from(scheduled_posts)
        .where(inArray(scheduled_posts.id, postIds)),
    );

    if (fetchError) {
      console.error(
        `[cancelScheduledPostBatch] [req=${requestId ?? "?"}] Fetch error:`,
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
      eligibleStatuses: POST_CHANGE_ELIGIBLE_STATUSES.cancel,
    });
    if (!rules.ok) {
      switch (rules.violation) {
        case "not_found":
          return { success: false, failure: "not_found", message: "No posts found with the provided IDs." };
        case "not_owned":
          console.warn(
            `[cancelScheduledPostBatch] [req=${requestId ?? "?"}] Ownership violation: ${principalId} tried to cancel ${rules.foreignPostIds.length} post(s) they don't own`,
          );
          return {
            success: false,
            failure: "not_found",
            message: `No post found for id(s): ${rules.foreignPostIds.join(", ")}.`,
          };
        case "not_eligible":
          return { success: false, failure: "not_eligible", message: "Only scheduled posts can be cancelled." };
        default: {
          const unhandledViolation: never = rules;
          return unhandledViolation;
        }
      }
    }
    const cancellablePosts = rules.eligiblePosts;

    const cancellableIds = cancellablePosts.map((post) => post.id);
    const { data: cancelledRows, error: updateError } = await runQuery(
      db
        .update(scheduled_posts)
        .set({ status: "cancelled", cancelled_by_sub_at: null })
        .where(
          and(
            inArray(scheduled_posts.id, cancellableIds),
            eq(scheduled_posts.principal_id, principalId),
            eq(scheduled_posts.status, "scheduled"),
          ),
        )
        .returning({ id: scheduled_posts.id }),
    );

    if (updateError) {
      console.error(
        `[cancelScheduledPostBatch] [req=${requestId ?? "?"}] Update error:`,
        updateError.message,
      );
      return {
        success: false,
        failure: "internal",
        message: "Database error cancelling posts.",
      };
    }

    if (cancelledRows.length === 0) {
      return {
        success: false,
        failure: "not_eligible",
        message: "Only scheduled posts can be cancelled.",
      };
    }

    return {
      success: true,
      message: `Cancelled ${cancelledRows.length} post(s).`,
      details: {
        total: postIds.length,
        succeeded: cancelledRows.length,
        failed: postIds.length - cancelledRows.length,
      },
    };
  } catch (err) {
    console.error(
      `[cancelScheduledPostBatch] [req=${requestId ?? "?"}] Unexpected error:`,
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      failure: "internal",
      message: "Unexpected error cancelling posts.",
    };
  }
}
