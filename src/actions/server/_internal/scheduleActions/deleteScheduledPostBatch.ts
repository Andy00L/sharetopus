import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { deleteSupabaseFileActionInternal } from "../data/deleteSupabaseFileAction";

/**
 * Deletes scheduled posts and cleans up orphaned media from Supabase Storage.
 *
 * Mirrors the web UI's delete flow in
 * src/actions/server/scheduleActions/deleteScheduledPost.ts but without
 * authCheck or checkRateLimit (the MCP tool handler has already verified
 * the principal and checked entitlements).
 *
 * Flow:
 *   1. Fetch posts including media_storage_path to know what to clean up.
 *   2. Verify ownership.
 *   3. Delete rows from scheduled_posts.
 *   4. For each unique media path, call deleteSupabaseFileActionInternal
 *      which checks if any other post still references the file before removing it.
 *
 * Tables touched: scheduled_posts (read + delete), Supabase Storage (delete)
 * Called by: src/lib/mcp/tools/deleteScheduledPosts.ts
 */
export async function deleteScheduledPostBatchInternal(
  postIds: string[],
  principalId: string
): Promise<{
  success: boolean;
  message: string;
  details?: { total: number; succeeded: number; failed: number; mediaDeleted: number };
}> {
  try {
    if (!postIds || postIds.length === 0) {
      return { success: false, message: "No post IDs provided." };
    }

    const { data: posts, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("id, principal_id, platform, media_storage_path")
      .in("id", postIds);

    if (fetchError || !posts || posts.length === 0) {
      return { success: false, message: "No posts found with the provided IDs." };
    }

    const unauthorized = posts.filter((p) => p.principal_id !== principalId);
    if (unauthorized.length > 0) {
      return { success: false, message: "You do not own some of these posts." };
    }

    const ids = posts.map((p) => p.id);
    const { error: deleteError } = await adminSupabase
      .from("scheduled_posts")
      .delete()
      .in("id", ids);

    if (deleteError) {
      return { success: false, message: "Database error deleting posts." };
    }

    // Clean up orphaned media files from Supabase Storage.
    // The web UI does this same thing. Keep them in sync.
    const uniqueMediaPaths = [
      ...new Set(
        posts
          .map((p) => p.media_storage_path)
          .filter((path): path is string => typeof path === "string" && path.length > 0)
      ),
    ];

    let mediaDeleted = 0;
    for (const mediaPath of uniqueMediaPaths) {
      try {
        const result = await deleteSupabaseFileActionInternal(
          principalId,
          mediaPath,
          false
        );
        if (result.success) {
          mediaDeleted++;
        } else {
          console.log(
            `[deleteScheduledPostBatchInternal] Media not deleted: ${mediaPath} - ${result.message}`
          );
        }
      } catch (fileError) {
        // Storage cleanup failure must not block the delete operation.
        console.error(
          `[deleteScheduledPostBatchInternal] Error cleaning up media: ${mediaPath}`,
          fileError instanceof Error ? fileError.message : fileError
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
      `[deleteScheduledPostBatchInternal] Error:`,
      err instanceof Error ? err.message : err
    );
    return { success: false, message: "Unexpected error deleting posts." };
  }
}
