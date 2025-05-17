// actions/server/contentHistoryActions/storeFailedPost.ts
import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";

type FailedPostData = {
  user_id: string | null;
  social_account_id: string;
  platform: string;
  post_title?: string | null;
  post_description?: string | null;
  post_options?: object;
  media_type: "image" | "video" | "text";
  media_storage_path: string;
  batch_id: string;
  scheduled_at?: string;
  extra_data?: Record<string, unknown>; // Simple extra data field
};

/**
 * Stores a record of a failed post attempt in the failed_posts table
 */
export async function storeFailedPost(
  data: FailedPostData
): Promise<{ success: boolean; message: string; recordId?: string }> {
  if (!data.user_id || !data.social_account_id || !data.platform) {
    return {
      success: false,
      message: "Missing required information",
    };
  }

  try {
    console.log(
      `[storeFailedPost] Storing failed post for user ${data.user_id}`
    );

    const insertData = {
      user_id: data.user_id,
      social_account_id: data.social_account_id,
      platform: data.platform,
      status: "failed",
      scheduled_at: data.scheduled_at || new Date().toISOString(),
      post_title: data.post_title || null,
      post_description: data.post_description || null,
      post_options: data.post_options,
      media_type: data.media_type,
      media_storage_path: data.media_storage_path,
      batch_id: data.batch_id,
      error_message: data.extra_data?.message || "Failed to post", // Default generic message
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: newRecord, error } = await adminSupabase
      .from("failed_posts")
      .insert(insertData)
      .select("id")
      .single();

    if (error) {
      console.error("[storeFailedPost] Supabase insert error:", error);
      return { success: false, message: `Database error: ${error.message}` };
    }

    return {
      success: true,
      message: "Failed post stored successfully",
      recordId: newRecord.id,
    };
  } catch (err) {
    console.error("[storeFailedPost] Unexpected error:", err);
    return {
      success: false,
      message: "An unexpected error occurred",
    };
  }
}
