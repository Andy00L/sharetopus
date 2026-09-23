import "server-only";

import type { NextRequest } from "next/server";

import { x402PaidEndpoint } from "@/lib/x402/middleware/x402PaidEndpoint";
import { getScheduledPosts } from "@/actions/server/scheduleActions/getScheduledPosts";
import type { PostStatus } from "@/lib/types/database.types";
import {
  isSchedulablePlatform,
  type SchedulablePlatform,
} from "@/lib/platforms/capabilities";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/x402/scheduled-posts
 *
 * Pays the list_posts action (price per pricing_actions). Reads scheduled
 * posts for the wallet.
 * Steps:
 * 1. Parse query params (status, platform, limit).
 * 2. x402 middleware handles payment and the charge.
 * 3. Query scheduled_posts filtered by principal_id.
 */

/** Page size bounds for ?limit. */
const DEFAULT_POSTS_LIMIT = 20;
const MAX_POSTS_LIMIT = 100;

/** sourceRef: database.types.ts PostStatus. */
const POST_STATUSES = [
  "scheduled",
  "queued",
  "processing",
  "posted",
  "failed",
  "cancelled",
] as const satisfies readonly PostStatus[];

function isPostStatus(value: string): value is (typeof POST_STATUSES)[number] {
  return POST_STATUSES.some((status) => status === value);
}

type ScheduledPostsParams = {
  status: PostStatus | undefined;
  platform: SchedulablePlatform | undefined;
  limit: number;
};

type ScheduledPostsResult = {
  posts: Array<{
    id: string;
    scheduled_at: string;
    status: string;
    platform: string;
    post_title: string | null;
    post_description: string | null;
    media_type: string;
    media_storage_path: string;
    error_message: string | null;
    batch_id: string | null;
    created_via: string;
  }>;
};

export const GET = x402PaidEndpoint<ScheduledPostsParams, ScheduledPostsResult>({
  endpointPath: "/api/x402/scheduled-posts",
  rateLimitScope: "x402:scheduled-posts",
  rateLimitPerMinute: 60,
  defaultAction: "list_posts",

  parseBody: async (req: NextRequest) => {
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    const platformParam = url.searchParams.get("platform");
    const limitParam = url.searchParams.get("limit");

    let status: PostStatus | undefined;
    if (statusParam) {
      if (!isPostStatus(statusParam)) {
        return {
          success: false,
          httpStatus: 400,
          errorKind: "invalid_status",
          message: `Invalid status "${statusParam}". Must be one of: ${POST_STATUSES.join(", ")}.`,
        };
      }
      status = statusParam;
    }

    let platform: SchedulablePlatform | undefined;
    if (platformParam) {
      if (!isSchedulablePlatform(platformParam)) {
        return {
          success: false,
          httpStatus: 400,
          errorKind: "invalid_platform",
          message: `Invalid platform "${platformParam}".`,
        };
      }
      platform = platformParam;
    }

    let limit = DEFAULT_POSTS_LIMIT;
    if (limitParam) {
      const parsedLimit = parseInt(limitParam, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_POSTS_LIMIT) {
        return {
          success: false,
          httpStatus: 400,
          errorKind: "invalid_limit",
          message: `limit must be between 1 and ${MAX_POSTS_LIMIT}.`,
        };
      }
      limit = parsedLimit;
    }

    return { success: true, data: { status, platform, limit } };
  },

  resolveAction: () => ({ success: true, action: "list_posts" }),

  handler: async ({ body, principal }) => {
    const result = await getScheduledPosts(principal.principalId, "x402", {
      status: body.status,
      platform: body.platform,
      limit: body.limit,
    });

    if (!result.success) {
      return {
        success: false,
        errorKind: "query_failed",
        message: result.message,
        refundable: true,
      };
    }

    // Safe projection: only the fields an agent needs.
    const posts = (result.data ?? []).map((post) => ({
      id: post.id,
      scheduled_at: post.scheduled_at,
      status: post.status,
      platform: post.platform,
      post_title: post.post_title,
      post_description: post.post_description,
      media_type: post.media_type,
      media_storage_path: post.media_storage_path,
      error_message: post.error_message,
      batch_id: post.batch_id,
      created_via: post.created_via,
    }));

    return { success: true, data: { posts } };
  },
});
