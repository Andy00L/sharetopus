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

export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.posts.get",
  handler: async (ctx, request) => {
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

export const PATCH = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.posts.patch",
  handler: async (ctx, request) => {
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

export const DELETE = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.posts.delete",
  handler: async (ctx, request) => {
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
