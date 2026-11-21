import "server-only";

import type { MediaType } from "@/db/schema";

export const POST_ACTION_PREFIX = "post.";

export function resolvePostAction(postType: string):
  | { success: true; action: string; mediaType: MediaType }
  | { success: false; httpStatus: number; errorKind: string; message: string } {
  switch (postType) {
    case "text":
      return { success: true, action: `${POST_ACTION_PREFIX}text`, mediaType: "text" };
    case "image":
      return { success: true, action: `${POST_ACTION_PREFIX}image`, mediaType: "image" };
    case "video":
      return { success: true, action: `${POST_ACTION_PREFIX}video`, mediaType: "video" };
    default:
      return {
        success: false,
        httpStatus: 400,
        errorKind: "invalid_post_type",
        message: `Invalid post_type "${postType}". Must be "text", "image", or "video".`,
      };
  }
}
