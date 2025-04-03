// db/posts.ts

import { supabase } from "@/actions/api/supabase";

/**
 * Mark a post as published with platform ID
 */
export async function markPostAsPublished(
  postId: string,
  providerPostId: string
): Promise<boolean> {
  const { error } = await supabase
    .from("social_media_posts")
    .update({
      status: "published",
      provider_post_id: providerPostId,
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId);

  if (error) {
    console.error("Error marking post as published:", error);
    return false;
  }

  return true;
}
