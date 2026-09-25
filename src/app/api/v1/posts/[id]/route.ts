import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { toPostDTO } from "@/lib/api/rest/dto/toPostDTO";
import type { PostDeleteResult } from "@/lib/api/rest/openapi/responseSchemas";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { restPostBatchFailureResponse } from "@/lib/api/rest/errors/restPostBatchFailureResponse";
import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";
import { updateScheduledTimeBatch } from "@/actions/server/scheduleActions/reschedule/updateScheduledTimeBatch";
import { cancelScheduledPostBatch } from "@/actions/server/scheduleActions/cancel/cancelScheduledPostBatch";
import { deleteScheduledPostBatch } from "@/actions/server/scheduleActions/delete/deleteScheduledPostBatch";
import {
  PostPatchInputSchema,
  PostDeleteQuerySchema,
} from "@/lib/api/rest/validation/postPatchSchemas";

const PostIdSchema = z.guid();

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
    // are filtered out by principal_id, so surface as no row -> 404.
    const { data: postRows, error: rowLookupError } = await runQuery(
      db
        .select()
        .from(scheduled_posts)
        .where(
          and(
            eq(scheduled_posts.id, postId),
            eq(scheduled_posts.principal_id, ctx.principal.principalId),
          ),
        )
        .limit(1),
    );
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
    const postRow = postRows[0];
    if (!postRow) {
      return restErrorResponse(
        "not_found",
        "Post not found",
        ctx.requestId,
      );
    }

    const postDto = toPostDTO(postRow);

    return {
      response: NextResponse.json(postDto, {
        status: 200,
        headers: { "x-request-id": ctx.requestId },
      }),
      auditSummary: { post_id: postDto.id, status: postDto.status },
    };
  },
});

/**
 * PATCH /v1/posts/[id] -- reschedule a post.
 *
 * Updates scheduled_at via updateScheduledTimeBatch, which checks
 * ownership and status and resumes cancelled posts (matches MCP behavior).
 * Only a scheduled or cancelled post can move; every other status answers
 * 409 conflict, and another principal's post answers 404 like a missing one.
 */
export const PATCH = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.posts.patch",
  handler: async (ctx, request) => {
    // Step 1: extract and validate post ID from URL path.
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

    // Step 2: parse and validate request body.
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return restErrorResponse(
        "validation_error",
        "Request body is not valid JSON",
        ctx.requestId,
      );
    }

    const bodyParseResult = PostPatchInputSchema.safeParse(rawBody);
    if (!bodyParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Request body failed validation",
        ctx.requestId,
        { issues: bodyParseResult.error.issues },
      );
    }
    const validatedPatchInput = bodyParseResult.data;

    // Step 3: reschedule. A refusal maps to the status the caller can act on.
    const rescheduleResult = await updateScheduledTimeBatch(
      [postId],
      validatedPatchInput.scheduled_at,
      ctx.principal.principalId,
      "api",
      ctx.requestId,
    );
    if (!rescheduleResult.success) {
      return restPostBatchFailureResponse(rescheduleResult, ctx.requestId);
    }

    // Step 4: fetch updated row for response DTO.
    const { data: updatedRows, error: fetchError } = await runQuery(
      db
        .select()
        .from(scheduled_posts)
        .where(
          and(
            eq(scheduled_posts.id, postId),
            eq(scheduled_posts.principal_id, ctx.principal.principalId),
          ),
        )
        .limit(1),
    );

    const updatedRow = updatedRows?.[0];
    if (fetchError || !updatedRow) {
      return restErrorResponse(
        "internal_error",
        "Post was rescheduled but could not be retrieved",
        ctx.requestId,
      );
    }

    return {
      response: NextResponse.json(toPostDTO(updatedRow), {
        status: 200,
        headers: { "x-request-id": ctx.requestId },
      }),
      auditSummary: {
        post_id: postId,
        new_scheduled_at: validatedPatchInput.scheduled_at,
      },
    };
  },
});

/**
 * DELETE /v1/posts/[id] -- cancel or hard-delete a post.
 *
 * Default (no query): soft-cancel via cancelScheduledPostBatch.
 * ?hard=true: permanent delete via deleteScheduledPostBatch (includes
 * media cleanup).
 *
 * 200 means the change happened; it carries the action and the batch
 * counts. Only a scheduled post can be cancelled; every other status
 * answers 409 conflict. A hard value other than true or false answers 400 instead
 * of falling back to a cancel.
 */
export const DELETE = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.posts.delete",
  handler: async (ctx, request) => {
    // Step 1: extract and validate post ID from URL path.
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

    // Step 2: parse the hard-delete flag. An unknown value is refused: a
    // fallback to cancel would do something the caller did not ask for.
    const queryObject = Object.fromEntries(
      new URL(request.url).searchParams,
    );
    const queryParseResult = PostDeleteQuerySchema.safeParse(queryObject);
    if (!queryParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Query parameter hard must be true or false",
        ctx.requestId,
        { issues: queryParseResult.error.issues },
      );
    }
    const isHardDelete = queryParseResult.data.hard;
    const action = isHardDelete ? "deleted" : "cancelled";

    // Step 3: delete or cancel. The batch function checks ownership and
    // status; a refusal maps to the status the caller can act on.
    const changeResult = isHardDelete
      ? await deleteScheduledPostBatch(
          [postId],
          ctx.principal.principalId,
          "api",
          ctx.requestId,
        )
      : await cancelScheduledPostBatch(
          [postId],
          ctx.principal.principalId,
          "api",
          ctx.requestId,
        );
    if (!changeResult.success) {
      return restPostBatchFailureResponse(changeResult, ctx.requestId);
    }

    return {
      response: NextResponse.json(
        { id: postId, action, details: changeResult.details } satisfies PostDeleteResult,
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: { post_id: postId, action },
    };
  },
});
