"use server";
import { authCheck } from "@/actions/server/authCheck";
import { authCheckCronJob } from "../../authCheckCronJob";
import { deleteSupabaseFile } from "./deleteSupabaseFile";

/**
 * Entry point for deleting files from Supabase Storage via browser sessions
 * (Clerk auth) and cron jobs (cronSecret).
 *
 * Thin wrapper: validates auth, then delegates all data-layer work to the
 * _internal version. MCP and other already-authenticated callers should use
 * the _internal version directly instead of going through this function.
 *
 * Tables touched (via _internal): scheduled_posts, failed_posts, Storage
 * Called by: web UI components, cron job handlers
 */
export async function deleteSupabaseFileAction(
  userId: string | null,
  filePath: string | null,
  forceDelete: boolean = false,
  cronSecret?: string,
): Promise<{ success: boolean; message: string }> {
  console.log(
    `[deleteSupabaseFile]: Starting deletion process for user: ${userId}, path: ${
      filePath ?? "entire folder"
    }`,
  );

  // Authentication: cron jobs use a secret key, regular users use Clerk.
  if (cronSecret) {
    const authResult = await authCheckCronJob(userId, cronSecret);
    if (!authResult) {
      return {
        success: false,
        message: "Cron job authentication failed. Invalid secret key.",
      };
    }
  } else {
    const authResult = await authCheck(userId);
    if (!authResult) {
      return {
        success: false,
        message: "Authentication validation failed. Please sign in again.",
      };
    }
  }

  if (!userId) {
    console.error("[deleteSupabaseFileAction]: No userId after auth check");
    return { success: false, message: "Missing user ID." };
  }

  // Auth passed. Delegate to the internal version.
  return deleteSupabaseFile(userId, filePath, forceDelete);
}
