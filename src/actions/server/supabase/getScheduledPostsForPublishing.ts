// db/posts.ts

import { supabase } from "@/actions/api/supabase";
import { SocialMediaPost } from "@/actions/types/SocialMediaPost";

/**
 * Get scheduled posts that need to be published
 */
export async function getScheduledPostsForPublishing(): Promise<
  SocialMediaPost[]
> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("social_media_posts")
    .select("*")
    .eq("status", "scheduled")
    .lt("scheduled_for", now);

  if (error) {
    console.error("Error fetching scheduled posts:", error);
    return [];
  }

  return data as SocialMediaPost[];
}
