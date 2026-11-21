import { resolvePlatformTextLimit } from "@/components/core/create/constants/captionLimits";
import type { MediaType } from "@/db/schema";

const PLATFORMS_READING_LINK: ReadonlySet<string> = new Set(["pinterest", "linkedin"]);

export type PostFieldsToValidate = {
  socialAccountId: string;
  platform: string;
  postType: MediaType;
  mediaStoragePath: string;
  description: string | null;
  link: string | null | undefined;
  pinterestBoardId: string | null | undefined;
};

export function validatePostFields(
  post: PostFieldsToValidate,
  principalId: string,
): string | null {
  if (!post.socialAccountId || !post.platform || !post.postType) {
    return "Missing required fields (socialAccountId, platform, postType).";
  }
  if (post.postType !== "text" && !post.mediaStoragePath) {
    return `Media file is required for ${post.postType} posts.`;
  }
  if (post.mediaStoragePath && !post.mediaStoragePath.startsWith(`${principalId}/`)) {
    return "Media path is not owned by the calling principal.";
  }
  if (post.platform === "pinterest" && !post.pinterestBoardId) {
    return "Pinterest posts require a board.";
  }
  if (post.platform !== "pinterest" && post.pinterestBoardId) {
    return "A board is only valid when platform='pinterest'.";
  }
  if (post.link && !PLATFORMS_READING_LINK.has(post.platform)) {
    return "A link is only valid for Pinterest and LinkedIn posts.";
  }
  if (post.description) {
    const captionLimit = resolvePlatformTextLimit(post.platform);
    if (post.description.length > captionLimit) {
      return `Caption exceeds ${post.platform} limit of ${captionLimit} chars (got ${post.description.length}).`;
    }
  }
  return null;
}
