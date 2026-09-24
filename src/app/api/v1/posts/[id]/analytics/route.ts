import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { toAnalyticsDTO } from "@/lib/api/rest/dto/toAnalyticsDTO";
import { db, runQuery } from "@/db/client";
import {
  analytics_metrics,
  content_history,
  scheduled_posts,
} from "@/db/schema";

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
    const { data: postRows, error: postError } = await runQuery(
      db
        .select({ id: scheduled_posts.id })
        .from(scheduled_posts)
        .where(
          and(
            eq(scheduled_posts.id, postId),
            eq(scheduled_posts.principal_id, ctx.principal.principalId),
          ),
        )
        .limit(1),
    );

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
    if (!postRows[0]) {
      return restErrorResponse(
        "not_found",
        "Post not found",
        ctx.requestId,
      );
    }

    // Step 3: find content_history entry for this post. scheduled_post_id is
    // not unique, so two rows are read: more than one history row stays an
    // error, as it was when this lookup required a single row.
    const { data: contentRows, error: contentError } = await runQuery(
      db
        .select({ content_id: content_history.content_id })
        .from(content_history)
        .where(
          and(
            eq(content_history.scheduled_post_id, postId),
            eq(content_history.principal_id, ctx.principal.principalId),
          ),
        )
        .limit(2),
    );

    if (contentError || contentRows.length > 1) {
      console.error(
        `[v1/posts/[id]/analytics GET] content_history lookup failed (request_id=${ctx.requestId}):`,
        contentError?.message ?? "more than one content_history row for this post",
      );
      return restErrorResponse(
        "internal_error",
        "Content history lookup failed",
        ctx.requestId,
      );
    }
    const contentRow = contentRows[0];
    if (!contentRow) {
      return restErrorResponse(
        "not_found",
        "Post has not been published",
        ctx.requestId,
      );
    }

    // Step 4: query analytics_metrics for this content_id.
    const { data: analyticsRows, error: analyticsError } = await runQuery(
      db
        .select()
        .from(analytics_metrics)
        .where(eq(analytics_metrics.content_id, contentRow.content_id))
        .orderBy(desc(analytics_metrics.metric_date))
        .limit(100),
    );

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

    const metricDtos = analyticsRows.map(toAnalyticsDTO);

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
