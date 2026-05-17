import type { MediaType } from "@/lib/types/database.types";

/**
 * Maps a post_type field from the request body to the corresponding
 * pricing_actions key. Used by post-now and schedule routes.
 *
 * "text" → "post.text" ($0.50)
 * "image" → "post.image" ($0.75)
 * "video" → "post.video" ($1.00)
 */
export function resolvePostAction(postType: string):
  | { success: true; action: string; mediaType: MediaType }
  | { success: false; httpStatus: number; errorKind: string; message: string } {
  switch (postType) {
    case "text":
      return { success: true, action: "post.text", mediaType: "text" };
    case "image":
      return { success: true, action: "post.image", mediaType: "image" };
    case "video":
      return { success: true, action: "post.video", mediaType: "video" };
    default:
      return {
        success: false,
        httpStatus: 400,
        errorKind: "invalid_post_type",
        message: `Invalid post_type "${postType}". Must be "text", "image", or "video".`,
      };
  }
}
