"use server";

import { adminSupabase } from "@/actions/api/supabase-client";

/**
 * Get all scheduled posts for the authenticated user
 *
 * @returns Array of scheduled posts
 */
export async function getScheduledPosts(userId: string | null) {
  if (!userId) {
    console.log("User not authenticated.");
  }

  try {
    // Join with social_accounts to get account details
    const { data, error } = await adminSupabase
      .from("scheduled_posts")
      .select(
        `
        *,
        social_accounts:social_account_id (
          id,
          platform,
          account_identifier,
          extra
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
