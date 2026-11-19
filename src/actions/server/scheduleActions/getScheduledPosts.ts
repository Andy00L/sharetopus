import "server-only";

import { and, asc, eq, ne } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { scheduled_posts, social_accounts } from "@/db/schema";
import type { CreatedVia, PostStatus } from "@/db/schema";
import type { ScheduledPostListItem } from "@/lib/types/dbTypes";
import { checkRateLimit } from "../rateLimit/checkRateLimit";

export async function getScheduledPosts(
  principalId: string,
  source: CreatedVia,
  filters?: {
    platform?: string;
    status?: PostStatus;
    limit?: number;
    includePosted?: boolean;
  },
): Promise<{
  success: boolean;
  message: string;
  data?: ScheduledPostListItem[];
  resetIn?: number;
}> {
  console.log(
    `[getScheduledPosts] Starting from source="${source}" for principal=${principalId}`,
  );

  try {
    const rateLimitScope = `${source}_get_scheduled_posts`;
    const rateCheck = await checkRateLimit(rateLimitScope, principalId, 60, 60);
    if (!rateCheck.success) {
      return {
        success: false,
        message: rateCheck.message,
        resetIn: rateCheck.resetIn,
      };
    }

    const statusCondition = filters?.status
      ? eq(scheduled_posts.status, filters.status)
      : filters?.includePosted
        ? undefined
        : ne(scheduled_posts.status, "posted");

    const scheduledPostsQuery = db
      .select({
        id: scheduled_posts.id,
        scheduled_at: scheduled_posts.scheduled_at,
        status: scheduled_posts.status,
        platform: scheduled_posts.platform,
        post_title: scheduled_posts.post_title,
        post_description: scheduled_posts.post_description,
        error_message: scheduled_posts.error_message,
        media_type: scheduled_posts.media_type,
        media_storage_path: scheduled_posts.media_storage_path,
        batch_id: scheduled_posts.batch_id,
        created_via: scheduled_posts.created_via,
        // id stays the first key: Drizzle returns null for a nested object
        // whose first column is null, which only happens when no account
        // row matched the left join.
        social_accounts: {
          id: social_accounts.id,
          display_name: social_accounts.display_name,
          avatar_url: social_accounts.avatar_url,
        },
      })
      .from(scheduled_posts)
      .leftJoin(
        social_accounts,
        eq(social_accounts.id, scheduled_posts.social_account_id),
      )
      .where(
        and(
          eq(scheduled_posts.principal_id, principalId),
          filters?.platform
            ? eq(scheduled_posts.platform, filters.platform)
            : undefined,
          statusCondition,
        ),
      )
      .orderBy(asc(scheduled_posts.scheduled_at))
      .$dynamic();

    const { data: postRows, error } = await runQuery(
      filters?.limit
        ? scheduledPostsQuery.limit(filters.limit)
        : scheduledPostsQuery,
    );

    if (error) {
      console.error("[getScheduledPosts] DB error:", error.message);
      return {
        success: false,
        message: "Could not load your scheduled posts. Please try again.",
      };
    }

    const posts: ScheduledPostListItem[] = postRows;

    return {
      success: true,
      message:
        posts.length > 0
          ? `Retrieved ${posts.length} scheduled post(s).`
          : "No scheduled posts found.",
      data: posts,
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
