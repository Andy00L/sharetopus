// Updated getScheduledPosts.ts
"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { ScheduledPost } from "@/lib/types/dbTypes";

/**
 * Get all scheduled posts for the authenticated user
 *
 * @returns Array of scheduled posts
 */
export async function getScheduledPosts(userId: string | null) {
  if (!userId) {
    console.log("[GetScheduledPosts]: User not authenticated.");
    return [];
  }

  try {
    // Join with social_accounts to get account details
    const { data, error } = await adminSupabase
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
        social_accounts:social_account_id (
          id,
          display_name,
          avatar_url
        )
      `
      )
      .eq("user_id", userId)
      .order("scheduled_at", { ascending: true });

    if (error) {
      console.error("[Get Scheduled Posts] Error:", error);
      throw new Error(`Failed to fetch scheduled posts: ${error.message}`);
    }
    return data || [];
  } catch (err) {
    console.error("[Get Scheduled Posts] Unexpected error:", err);
    throw err;
  }
}
/**
 * Group scheduled posts by batch ID
 */
export async function getScheduledPostsGroupedByBatch(userId: string | null) {
  try {
    const posts = await getScheduledPosts(userId);

    // Group posts by batch_id
    const groupedPosts = posts.reduce(
      (acc: Record<string, ScheduledPost[]>, post) => {
        const batchId = post.batch_id;
        if (!acc[batchId]) {
          acc[batchId] = [];
        }
        acc[batchId].push(post);
        return acc;
      },
      {}
    );

    return {
      success: true,
      data: groupedPosts,
    };
  } catch (err) {
    console.error("[Group Scheduled Posts] Error:", err);
    return {
      success: false,
      data: null,
    };
  }
}
