// db/posts.ts

import { supabase } from "@/actions/api/supabase";

/**
 * Mark a post as failed with reason
 */
export async function markPostAsFailed(
  postId: string,
  failureReason: string
): Promise<boolean> {
  const { error } = await supabase
    .from("social_media_posts")
    .update({
      status: "failed",
      failure_reason: failureReason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId);

  if (error) {
    console.error("Error marking post as failed:", error);
    return false;
  }

  return true;
}
