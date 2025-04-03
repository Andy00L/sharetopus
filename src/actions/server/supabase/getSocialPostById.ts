// db/posts.ts

import { supabase } from "@/actions/api/supabase";
import { SocialMediaPost } from "@/actions/types/SocialMediaPost";

/**
 * Get a single post by ID
 */
export async function getSocialPostById(
  postId: string
): Promise<SocialMediaPost | null> {
  const { data, error } = await supabase
    .from("social_media_posts")
    .select("*")
    .eq("id", postId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // No rows returned
      return null;
    }
    console.error("Error fetching post:", error);
    throw error;
  }

  return data as SocialMediaPost;
}
