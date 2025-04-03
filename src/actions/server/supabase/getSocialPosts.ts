// db/posts.ts

import { supabase } from "@/actions/api/supabase";
import { PostStatus } from "@/actions/types/PostStatus ";
import { Provider } from "@/actions/types/provider";
import { SocialMediaPost } from "@/actions/types/SocialMediaPost";

/**
 * Get all posts by user
 */
export async function getSocialPosts(
  userId: string,
  options?: {
    provider?: Provider;
    status?: PostStatus;
    limit?: number;
    page?: number;
  }
): Promise<SocialMediaPost[]> {
  let query = supabase
    .from("social_media_posts")
    .select("*")
    .eq("user_id", userId);

  if (options?.provider) {
    query = query.eq("provider", options.provider);
  }

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  // Add pagination
  const limit = options?.limit ?? 20;
  const page = options?.page ?? 1;
  const offset = (page - 1) * limit;

  query = query
    .order("created_at", { ascending: false })
    .limit(limit)
    .range(offset, offset + limit - 1);

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching social posts:", error);
    return [];
  }

  return data as SocialMediaPost[];
}
