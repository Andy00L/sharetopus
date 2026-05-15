import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { toPostDTO } from "@/lib/api/rest/dto/toPostDTO";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { adminSupabase } from "@/actions/api/adminSupabase";

const PostIdSchema = z.string().uuid();

/**
 * GET /v1/posts/[id] -- fetch one post by ID.
 *
 * Principal-scoped. Posts owned by other principals return 404
 * (we do not leak existence of unrelated posts).
 */
export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.posts.get",
  handler: async (ctx, request) => {
    // Step 1: extract id from URL path. HOF doesn't parse path params.
    const urlSegments = new URL(request.url).pathname.split("/");
    const idCandidate = urlSegments[urlSegments.length - 1] ?? "";

    const idParseResult = PostIdSchema.safeParse(idCandidate);
    if (!idParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Invalid post id format",
        ctx.requestId,
      );
    }
    const postId = idParseResult.data;

    // Step 2: fetch row scoped to calling principal. Other users' posts
    // are filtered out by principal_id, so surface as null -> 404.
    const { data: postRow, error: rowLookupError } = await adminSupabase
      .from("scheduled_posts")
      .select("*")
      .eq("id", postId)
      .eq("principal_id", ctx.principal.principalId)
      .maybeSingle();
    if (rowLookupError) {
      console.error(
        `[v1/posts/[id] GET] lookup failed (request_id=${ctx.requestId}):`,
        rowLookupError.message,
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

    return NextResponse.json(toPostDTO(postRow), {
      status: 200,
      headers: { "x-request-id": ctx.requestId },
    });
  },
});
