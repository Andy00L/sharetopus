// src/actions/server/scheduleActions/get/getScheduledPosts.ts
import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { CreatedVia, PostStatus } from "@/lib/types/database.types";
import type { ScheduledPost } from "@/lib/types/dbTypes";
import { checkRateLimit } from "../rateLimit/checkRateLimit";

/**
 * Fetches scheduled posts owned by `principalId`, optionally filtered.
 *
 * **Authentication:** Does not call Clerk. Caller must validate
 * `principalId` (RSC: `auth()`; MCP: `extractPrincipal`).
 *
 * **Rate limiting:** 60 requests per 60s, scoped per source
 * (`web_get_scheduled_posts`, `mcp_get_scheduled_posts`).
 *
 * **Tables:** `scheduled_posts`, `social_accounts` (join).
 *
 * Default filter: excludes status='posted' (matches existing web UI behavior).
 * Caller can override by passing an explicit status in `filters`.
 */
export async function getScheduledPosts(
  principalId: string,
  source: CreatedVia,
  filters?: {
    platform?: string;
    status?: PostStatus;
    limit?: number;
  },
): Promise<{
  success: boolean;
  message: string;
  data?: ScheduledPost[];
  resetIn?: number;
}> {
  console.log(
    `[getScheduledPosts] Starting from source="${source}" for principal=${principalId}`,
  );

  try {
    // Step 1: rate limit
    const rateLimitScope = `${source}_get_scheduled_posts`;
    const rateCheck = await checkRateLimit(rateLimitScope, principalId, 60, 60);
    if (!rateCheck.success) {
      return {
        success: false,
        message: "Too many requests. Please try again later.",
        resetIn: rateCheck.resetIn,
      };
    }

    // Step 2: build query
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
      `,
      )
      .eq("principal_id", principalId)
      .order("scheduled_at", { ascending: true });

    if (filters?.platform) {
      query = query.eq("platform", filters.platform);
    }
    if (filters?.status) {
      query = query.eq("status", filters.status);
    } else {
      query = query.neq("status", "posted");
    }
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[getScheduledPosts] DB error:", error.message);
      return {
        success: false,
        message: `Failed to retrieve scheduled posts: ${error.message}`,
      };
    }

    return {
      success: true,
      message:
        data && data.length > 0
          ? `Retrieved ${data.length} scheduled post(s).`
          : "No scheduled posts found.",
      data: (data ?? []) as unknown as ScheduledPost[],
    };
  } catch (err) {
    console.error(
      `[getScheduledPosts] Unexpected error:`,
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      message: "Unexpected error fetching scheduled posts.",
    };
  }
}
