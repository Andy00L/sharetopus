// db/posts.ts
import { supabase } from "@/actions/api/supabase";
import { PostStatus } from "@/actions/types/PostStatus ";
import { Provider } from "@/actions/types/provider";
import { SocialMediaPost } from "./supabase";

/**
 * Create a new social media post
 */
export async function createSocialPost(
  userId: string,
  postData: {
    provider: Provider;
    caption: string;
    media_url?: string;
    thumbnail_url?: string;
    status: PostStatus;
    scheduled_for?: string;
    published_at?: string;
    provider_post_id?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<SocialMediaPost | null> {
  const now = new Date().toISOString();

  const newPost = {
    user_id: userId,
    provider: postData.provider,
    caption: postData.caption,
    media_url: postData.media_url,
    thumbnail_url: postData.thumbnail_url,
    status: postData.status,
    scheduled_for: postData.scheduled_for,
    published_at: postData.published_at,
    provider_post_id: postData.provider_post_id,
    metadata: postData.metadata ? JSON.stringify(postData.metadata) : undefined,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from("social_media_posts")
    .insert(newPost)
    .select()
    .single();

  if (error) {
    console.error("Error creating social post:", error);
    return null;
  }

  return data as SocialMediaPost;
}
