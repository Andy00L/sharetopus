import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { ScheduledPost } from "@/lib/types/dbTypes";

/**
 * Fetches scheduled posts for a principal without authCheck.
 *
 * Mirrors src/actions/server/scheduleActions/getScheduledPosts.ts
 * but skips Clerk auth and rate limiting (handled by MCP entitlement layer).
 *
 * Tables read: scheduled_posts, social_accounts (join)
 * Called by: src/lib/mcp/tools/listScheduledPosts.ts
 */
export async function getScheduledPostsInternal(
  principalId: string,
  filters?: {
    platform?: string;
    status?: "scheduled" | "processing" | "posted" | "failed" | "cancelled";
    limit?: number;
  }
): Promise<{
  success: boolean;
  message: string;
  data?: ScheduledPost[];
}> {
  try {
    let query = adminSupabase
      .from("scheduled_posts")
      .select(
        `
        id,
        scheduled_at,
        status,
        platform,
        post_title,
        post_description,
        error_message,
        media_type,
        media_storage_path,
        batch_id,
        created_via,
        social_accounts:social_account_id (
          id,
          display_name,
          avatar_url
        )
      `
      )
      .eq("principal_id", principalId)
      .order("scheduled_at", { ascending: true });

    if (filters?.platform) {
      query = query.eq("platform", filters.platform);
    }
    if (filters?.status) {
      query = query.eq("status", filters.status);
    }
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) {
      return {
        success: false,
        message: `Failed to retrieve scheduled posts: ${error.message}`,
      };
    }

    return {
      success: true,
      message:
        data && data.length > 0
          ? `Retrieved ${data.length} scheduled posts.`
          : "No scheduled posts found.",
      data: (data ?? []) as unknown as ScheduledPost[],
    };
  } catch (err) {
    console.error(
      `[getScheduledPostsInternal] Unexpected error:`,
      err instanceof Error ? err.message : err
    );
    return {
      success: false,
      message: "Unexpected error fetching scheduled posts.",
    };
  }
}
