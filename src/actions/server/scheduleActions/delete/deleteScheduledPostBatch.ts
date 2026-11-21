import "server-only";

import { inArray } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";
import type { CreatedVia } from "@/db/schema";
import type { PostChangeFailure } from "@/lib/types/postBatch";
import { deleteUnreferencedMediaFiles } from "../../data/storageFiles/deleteSupabaseFile";
import { checkRateLimit } from "../../rateLimit/checkRateLimit";
import { DELETE_POST_BATCH_RATE_LIMIT } from "@/actions/server/rateLimit/rateLimitRules";
import {
  checkPostChangeRules,
  POST_CHANGE_ELIGIBLE_STATUSES,
} from "../preflightScheduledPostChange";

export type DeleteScheduledPostBatchResult = {
  message: string;
  resetIn?: number;
} & (
  | {
      success: true;
      details: {
        total: number;
        succeeded: number;
        failed: number;
        mediaDeleted: number;
      };
    }
  | { success: false; failure: PostChangeFailure }
);

export async function deleteScheduledPostBatch(
  postIds: string[],
  principalId: string,
  source: CreatedVia,
  requestId?: string | null,
): Promise<DeleteScheduledPostBatchResult> {
  console.log(
    `[deleteScheduledPostBatch] [req=${requestId ?? "?"}] Starting from source="${source}" for principal=${principalId}, ${postIds?.length ?? 0} post(s) requested`,
  );

  try {
    if (!postIds || postIds.length === 0) {
      return {
        success: false,
        failure: "invalid_request",
        message: "No post IDs provided.",
      };
    }

    const rateLimitScope = `${source}_delete_scheduled_posts`;
    const rateCheck = await checkRateLimit({
      operation: rateLimitScope,
      identifier: principalId,
      rule: DELETE_POST_BATCH_RATE_LIMIT,
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
          media_storage_path: scheduled_posts.media_storage_path,
        })
        .from(scheduled_posts)
        .where(inArray(scheduled_posts.id, postIds)),
    );

    if (fetchError) {
      console.error(
        `[deleteScheduledPostBatch] [req=${requestId ?? "?"}] Fetch error:`,
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
      eligibleStatuses: POST_CHANGE_ELIGIBLE_STATUSES.delete,
    });
    if (!rules.ok) {
      switch (rules.violation) {
        case "not_found":
        case "not_eligible":
          return { success: false, failure: "not_found", message: "No posts found with the provided IDs." };
        case "not_owned":
          console.warn(
            `[deleteScheduledPostBatch] [req=${requestId ?? "?"}] Ownership violation: ${principalId} tried to delete ${rules.foreignPostIds.length} post(s) they don't own`,
          );
          return {
            success: false,
            failure: "not_found",
            message: `No post found for id(s): ${rules.foreignPostIds.join(", ")}.`,
          };
        default: {
          const unhandledViolation: never = rules;
          return unhandledViolation;
        }
      }
    }

    const postIdsToDelete = rules.eligiblePosts.map((post) => post.id);
    const { error: deleteError } = await runQuery(
      db
        .delete(scheduled_posts)
        .where(inArray(scheduled_posts.id, postIdsToDelete)),
    );

    if (deleteError) {
      console.error(
        `[deleteScheduledPostBatch] [req=${requestId ?? "?"}] Delete error:`,
        deleteError.message,
      );
      return {
        success: false,
        failure: "internal",
        message: "Database error deleting posts.",
      };
    }

    const mediaCleanup = await deleteUnreferencedMediaFiles(
      principalId,
      posts.map((post) => post.media_storage_path),
    );
    if (!mediaCleanup.success) {
      console.error(
        `[deleteScheduledPostBatch] [req=${requestId ?? "?"}] Media cleanup failed:`,
        mediaCleanup.message,
      );
    }
    const mediaDeleted = mediaCleanup.success ? mediaCleanup.removedCount : 0;

    return {
      success: true,
      message: `Deleted ${posts.length} post(s).`,
      details: {
        total: postIds.length,
        succeeded: posts.length,
        failed: postIds.length - posts.length,
        mediaDeleted,
      },
    };
  } catch (err) {
    console.error(
      `[deleteScheduledPostBatch] [req=${requestId ?? "?"}] Unexpected error:`,
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      failure: "internal",
      message: "Unexpected error deleting posts.",
    };
  }
}
