// db/posts.ts

import { supabase } from "@/actions/api/supabase";
import { PostStatus } from "@/actions/types/PostStatus ";

/**
 * Update an existing social media post
 */
export async function updateSocialPost(
  postId: string,
  updates: Partial<{
    caption: string;
    media_url: string;
    thumbnail_url: string;
    status: PostStatus;
    scheduled_for: string | null;
    published_at: string | null;
    provider_post_id: string;
    failure_reason: string | null;
    metadata: Record<string, unknown> | null;
  }>
): Promise<boolean> {
  const updateData: Record<string, unknown> = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  // Convert metadata to string if it exists
  if (updates.metadata !== undefined) {
    updateData.metadata = updates.metadata
      ? JSON.stringify(updates.metadata)
      : null;
  }

  const { error } = await supabase
    .from("social_media_posts")
    .update(updateData)
    .eq("id", postId);

  if (error) {
    console.error("Error updating social post:", error);
    return false;
  }

  return true;
}
