// src/actions/server/scheduleActions/delete/deleteScheduledPostBatch.ts
import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { CreatedVia } from "@/lib/types/database.types";
import { deleteSupabaseFile } from "../../data/storageFiles/deleteSupabaseFile";
import { checkRateLimit } from "../../rateLimit/checkRateLimit";

/**
 * Deletes scheduled posts in batch and cleans up orphaned media from Storage.
 *
 * **Authentication:** Does not call Clerk. Caller must validate
 * `principalId` (Server Action: `auth()`; MCP: `extractPrincipal`).
 *
 * **Rate limiting:** 30 requests per 60s, scoped per source.
 *
 * **Tables:** `scheduled_posts` (read + delete), Supabase Storage (delete).
 *
 * Flow:
 *   1. Rate limit check
 *   2. Fetch posts including media_storage_path
 *   3. Verify ownership
 *   4. Delete rows from scheduled_posts
 *   5. Parallel cleanup of unique media paths via deleteSupabaseFile
 *      (which checks if any other table still references each file)
 *
 * @param postIds - Array of scheduled_posts.id to delete
 * @param principalId - Owner principal; ownership check enforced
 * @param source - Channel label; drives rate-limit scope
 */
export async function deleteScheduledPostBatch(
  postIds: string[],
  principalId: string,
  source: CreatedVia,
): Promise<{
  success: boolean;
  message: string;
  resetIn?: number;
  details?: {
    total: number;
    succeeded: number;
    failed: number;
    mediaDeleted: number;
  };
}> {
  console.log(
    `[deleteScheduledPostBatch] Starting from source="${source}" for principal=${principalId}, ${postIds?.length ?? 0} post(s) requested`,
  );

  try {
    if (!postIds || postIds.length === 0) {
      return { success: false, message: "No post IDs provided." };
    }

    // Step 1: rate limit
    const rateLimitScope = `${source}_delete_scheduled_posts`;
    const rateCheck = await checkRateLimit(rateLimitScope, principalId, 30, 60);
    if (!rateCheck.success) {
      return {
        success: false,
        message: "Too many requests. Please try again later.",
        resetIn: rateCheck.resetIn,
      };
    }

    // Step 2: fetch posts and verify ownership
    const { data: posts, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("id, principal_id, platform, media_storage_path")
      .in("id", postIds);

    if (fetchError || !posts || posts.length === 0) {
      return {
        success: false,
        message: "No posts found with the provided IDs.",
      };
    }

    const unauthorizedPosts = posts.filter(
      (post) => post.principal_id !== principalId,
    );
    if (unauthorizedPosts.length > 0) {
      console.warn(
        `[deleteScheduledPostBatch] Ownership violation: ${principalId} tried to delete ${unauthorizedPosts.length} post(s) they don't own`,
      );
      return {
        success: false,
        message: "You do not own some of these posts.",
      };
    }

    // Step 3: delete posts from DB
    const postIdsToDelete = posts.map((post) => post.id);
    const { error: deleteError } = await adminSupabase
      .from("scheduled_posts")
      .delete()
      .in("id", postIdsToDelete);

    if (deleteError) {
      console.error(
        `[deleteScheduledPostBatch] Delete error:`,
        deleteError.message,
      );
      return { success: false, message: "Database error deleting posts." };
    }

    // Step 4: parallel media cleanup. deleteSupabaseFile re-checks all
    // reference tables (failed_posts, pending pulls, etc.) and preserves
    // files still referenced.
    const uniqueMediaPaths = [
      ...new Set(
        posts
          .map((post) => post.media_storage_path)
          .filter(
            (path): path is string =>
              typeof path === "string" && path.length > 0,
          ),
      ),
    ];

    const cleanupResults = await Promise.allSettled(
      uniqueMediaPaths.map((mediaPath) =>
        deleteSupabaseFile(principalId, mediaPath, false),
      ),
    );

    let mediaDeleted = 0;
    for (const cleanupResult of cleanupResults) {
      if (
        cleanupResult.status === "fulfilled" &&
        cleanupResult.value.success === true
      ) {
        mediaDeleted++;
      } else if (cleanupResult.status === "rejected") {
        console.error(
          `[deleteScheduledPostBatch] Media cleanup threw:`,
          cleanupResult.reason,
        );
      }
    }

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
      `[deleteScheduledPostBatch] Unexpected error:`,
      err instanceof Error ? err.message : err,
    );
    return { success: false, message: "Unexpected error deleting posts." };
  }
}
