import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { toPostDTO } from "@/lib/api/rest/dto/toPostDTO";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { adminSupabase } from "@/actions/api/adminSupabase";
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
 * Updates scheduled_at via updateScheduledTimeBatch. Automatically
 * resumes cancelled posts (matches MCP behavior).
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

    // Step 3: verify ownership before calling batch function.
    const { data: existingPost, error: ownershipError } = await adminSupabase
      .from("scheduled_posts")
      .select("id, status")
      .eq("id", postId)
      .eq("principal_id", ctx.principal.principalId)
      .maybeSingle();

    if (ownershipError) {
      console.error(
        `[v1/posts/[id] PATCH] ownership check failed (request_id=${ctx.requestId}):`,
        ownershipError.message,
      );
      return restErrorResponse(
        "internal_error",
        "Post lookup failed",
        ctx.requestId,
      );
    }
    if (!existingPost) {
      return restErrorResponse(
        "not_found",
        "Post not found",
        ctx.requestId,
      );
    }

    // Step 4: call updateScheduledTimeBatch. It auto-resumes cancelled posts.
    const rescheduleResult = await updateScheduledTimeBatch(
      [postId],
      validatedPatchInput.scheduled_at,
      ctx.principal.principalId,
      "api",
      ctx.requestId,
    );

    if (!rescheduleResult.success) {
      return restErrorResponse(
        "internal_error",
        rescheduleResult.message,
        ctx.requestId,
      );
    }

    // Step 5: fetch updated row for response DTO.
    const { data: updatedRow, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("*")
      .eq("id", postId)
      .eq("principal_id", ctx.principal.principalId)
      .single();

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
 * Returns 200 with action taken and batch details. Mirrors the batch
 * behavior: returns succeeded/failed counts rather than 409 on status
 * mismatch.
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

    // Step 2: parse query params for hard delete flag.
    const queryObject = Object.fromEntries(
      new URL(request.url).searchParams,
    );
    const queryParseResult = PostDeleteQuerySchema.safeParse(queryObject);
    const isHardDelete = queryParseResult.success
      ? queryParseResult.data.hard
      : false;

    // Step 3: verify ownership.
    const { data: existingPost, error: ownershipError } = await adminSupabase
      .from("scheduled_posts")
      .select("id")
      .eq("id", postId)
      .eq("principal_id", ctx.principal.principalId)
      .maybeSingle();

    if (ownershipError) {
      console.error(
        `[v1/posts/[id] DELETE] ownership check failed (request_id=${ctx.requestId}):`,
        ownershipError.message,
      );
      return restErrorResponse(
        "internal_error",
        "Post lookup failed",
        ctx.requestId,
      );
    }
    if (!existingPost) {
      return restErrorResponse(
        "not_found",
        "Post not found",
        ctx.requestId,
      );
    }

    // Step 4: dispatch to correct batch function.
    const action = isHardDelete ? "deleted" : "cancelled";

    if (isHardDelete) {
      const deleteResult = await deleteScheduledPostBatch(
        [postId],
        ctx.principal.principalId,
        "api",
        ctx.requestId,
      );

      return {
        response: NextResponse.json(
          {
            id: postId,
            action,
            details: deleteResult.details ?? null,
          },
          { status: 200, headers: { "x-request-id": ctx.requestId } },
        ),
        auditSummary: { post_id: postId, action },
      };
    }

    const cancelResult = await cancelScheduledPostBatch(
      [postId],
      ctx.principal.principalId,
      "api",
      ctx.requestId,
    );

    return {
      response: NextResponse.json(
        {
          id: postId,
          action,
          details: cancelResult.details ?? null,
        },
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: { post_id: postId, action },
    };
  },
});
