import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { toAnalyticsDTO } from "@/lib/api/rest/dto/toAnalyticsDTO";
import { adminSupabase } from "@/actions/api/adminSupabase";

const PostIdSchema = z.guid();

/**
 * GET /v1/posts/[id]/analytics -- per-post analytics metrics.
 *
 * Joins scheduled_posts -> content_history (via scheduled_post_id)
 * -> analytics_metrics (via content_id) to find metrics for a
 * specific post.
 *
 * Returns 404 if the post has no content_history entry (not yet published).
 */
export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.posts.analytics",
  handler: async (ctx, request) => {
    // Step 1: extract post ID from URL path.
    // Path: /api/v1/posts/[id]/analytics -> id is third-to-last segment.
    const urlSegments = new URL(request.url).pathname.split("/");
    const idCandidate = urlSegments[urlSegments.length - 2] ?? "";

    const idParseResult = PostIdSchema.safeParse(idCandidate);
    if (!idParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Invalid post id format",
        ctx.requestId,
      );
    }
    const postId = idParseResult.data;

    // Step 2: verify post ownership.
    const { data: postRow, error: postError } = await adminSupabase
      .from("scheduled_posts")
      .select("id")
      .eq("id", postId)
      .eq("principal_id", ctx.principal.principalId)
      .maybeSingle();

    if (postError) {
      console.error(
        `[v1/posts/[id]/analytics GET] post lookup failed (request_id=${ctx.requestId}):`,
        postError.message,
      );
      return restErrorResponse(
        "internal_error",
        "Post lookup failed",
        ctx.requestId,
      );
    }
    if (!postRow) {
      return restErrorResponse(
        "not_found",
        "Post not found",
        ctx.requestId,
      );
    }

    // Step 3: find content_history entry for this post.
    const { data: contentRow, error: contentError } = await adminSupabase
      .from("content_history")
      .select("content_id")
      .eq("scheduled_post_id", postId)
      .eq("principal_id", ctx.principal.principalId)
      .maybeSingle();

    if (contentError) {
      console.error(
        `[v1/posts/[id]/analytics GET] content_history lookup failed (request_id=${ctx.requestId}):`,
        contentError.message,
      );
      return restErrorResponse(
        "internal_error",
        "Content history lookup failed",
        ctx.requestId,
      );
    }
    if (!contentRow) {
      return restErrorResponse(
        "not_found",
        "Post has not been published",
        ctx.requestId,
      );
    }

    // Step 4: query analytics_metrics for this content_id.
    const { data: analyticsRows, error: analyticsError } =
      await adminSupabase
        .from("analytics_metrics")
        .select("*")
        .eq("content_id", contentRow.content_id)
        .order("metric_date", { ascending: false })
        .limit(100);

    if (analyticsError) {
      console.error(
        `[v1/posts/[id]/analytics GET] analytics query failed (request_id=${ctx.requestId}):`,
        analyticsError.message,
      );
      return restErrorResponse(
        "internal_error",
        "Analytics query failed",
        ctx.requestId,
      );
    }

    const metricDtos = (analyticsRows ?? []).map(toAnalyticsDTO);

    return {
      response: NextResponse.json(
        {
          post_id: postId,
          content_id: contentRow.content_id,
          metrics: metricDtos,
        },
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        post_id: postId,
        content_id: contentRow.content_id,
        metric_count: metricDtos.length,
      },
    };
  },
});
