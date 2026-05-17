import "server-only";

import type { NextRequest } from "next/server";

import { x402PaidEndpoint } from "@/lib/x402/middleware/x402PaidEndpoint";
import { getScheduledPosts } from "@/actions/server/scheduleActions/getScheduledPosts";
import type { PostStatus } from "@/lib/types/database.types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/x402/scheduled-posts
 *
 * Pays list_posts for $0.001 USDC. Reads scheduled posts for the wallet.
 * Steps:
 * 1. Parse query params (status, platform, limit).
 * 2. x402 middleware handles auth, payment, charge.
 * 3. Query scheduled_posts filtered by principal_id.
 * 4. Return post list.
 */

type ScheduledPostsParams = {
  status: PostStatus | undefined;
  platform: string | undefined;
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

const VALID_STATUSES: PostStatus[] = ["scheduled", "queued", "processing", "posted", "failed", "cancelled"];

export const GET = x402PaidEndpoint<ScheduledPostsParams, ScheduledPostsResult>({
  endpointPath: "/api/x402/scheduled-posts",
  rateLimitScope: "x402:scheduled-posts",
  rateLimitPerMinute: 60,

  parseBody: async (req: NextRequest) => {
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    const platform = url.searchParams.get("platform") ?? undefined;
    const limitParam = url.searchParams.get("limit");

    let status: PostStatus | undefined;
    if (statusParam) {
      if (!VALID_STATUSES.includes(statusParam as PostStatus)) {
        return {
          success: false,
          httpStatus: 400,
          errorKind: "invalid_status",
          message: `Invalid status "${statusParam}". Must be one of: ${VALID_STATUSES.join(", ")}.`,
        };
      }
      status = statusParam as PostStatus;
    }

    let limit = 20;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 100) {
        return {
          success: false,
          httpStatus: 400,
          errorKind: "invalid_limit",
          message: "limit must be between 1 and 100.",
        };
      }
      limit = parsed;
    }

    return { success: true, data: { status, platform, limit } };
  },

  resolveAction: () => ({ success: true, action: "list_posts" }),

  handler: async ({ body, principal }) => {
    const result = await getScheduledPosts(
      principal.principalId,
      "x402",
      {
        status: body.status,
        platform: body.platform,
        limit: body.limit,
      },
    );

    if (!result.success) {
      return {
        success: false,
        errorKind: "query_failed",
        message: result.message,
        refundable: true,
      };
    }

    // Project fields (no tokens or sensitive data in scheduled_posts).
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

    return {
      success: true,
      data: { posts },
    };
  },
});
