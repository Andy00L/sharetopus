import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import {
  newestFirst,
  rowsAfter,
  toListPage,
} from "@/lib/api/rest/pagination";
import {
  PostCreateInputSchema,
  PostListQuerySchema,
} from "@/lib/api/rest/validation/schemas";
import {
  restInputToSchedulePostData,
  restInputToDirectPostData,
} from "@/lib/api/rest/adapters/restInputToScheduledPost";
import { toPostDTO } from "@/lib/api/rest/dto/toPostDTO";
import type { PostDispatch } from "@/lib/api/rest/openapi/responseSchemas";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { restPostBatchFailureResponse } from "@/lib/api/rest/errors/restPostBatchFailureResponse";
import { schedulePostBatch } from "@/actions/server/scheduleActions/schedule/schedulePostBatch";
import { directPostBatch } from "@/actions/server/directPostActions/directPostBatch";
import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";

export const POST = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.posts.create",
  handler: async (ctx, request) => {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch (parseError) {
      return restErrorResponse(
        "validation_error",
        "Request body is not valid JSON",
        ctx.requestId,
        {
          parse_error:
            parseError instanceof Error
              ? parseError.message
              : "unknown parse error",
        },
      );
    }

    const validationResult = PostCreateInputSchema.safeParse(rawBody);
    if (!validationResult.success) {
      return restErrorResponse(
        "validation_error",
        "Request body failed validation",
        ctx.requestId,
        { issues: validationResult.error.issues },
      );
    }
    const validatedInput = validationResult.data;

    const isDirectPost = !validatedInput.scheduled_at;

    if (isDirectPost) {
      const directPostInput = restInputToDirectPostData(validatedInput);
      const batchResult = await directPostBatch(
        [directPostInput],
        ctx.principal.principalId,
        "api",
        undefined,
        ctx.requestId,
      );

      if (!batchResult.success) {
        return restPostBatchFailureResponse(batchResult, ctx.requestId);
      }

      const [dispatchId] = batchResult.eventIds;
      if (!dispatchId) {
        console.error(
          `[v1/posts POST] dispatch for batch_id=${batchResult.batchId} succeeded without a dispatch id (request_id=${ctx.requestId})`,
        );
        return restErrorResponse(
          "internal_error",
          "The post was dispatched but its dispatch id is missing",
          ctx.requestId,
        );
      }

      const postDispatch = {
        dispatch_id: dispatchId,
        batch_id: batchResult.batchId,
        status: "processing",
        platform: validatedInput.platform,
        social_account_id: validatedInput.social_account_id,
      } satisfies PostDispatch;
      return {
        response: NextResponse.json(postDispatch, {
          status: 202,
          headers: { "x-request-id": ctx.requestId },
        }),
        auditSummary: {
          dispatch_id: postDispatch.dispatch_id,
          scheduled: false,
          platform: postDispatch.platform,
          batch_id: postDispatch.batch_id,
        },
      };
    }

    const schedulePostInput = restInputToSchedulePostData(validatedInput);
    const batchResult = await schedulePostBatch(
      [schedulePostInput],
      ctx.principal.principalId,
      "api",
      ctx.requestId,
    );

    if (!batchResult.success) {
      return restPostBatchFailureResponse(batchResult, ctx.requestId);
    }

    const createdPostId = batchResult.scheduleIds?.[0] ?? null;
    if (!createdPostId) {
      return restErrorResponse(
        "internal_error",
        "Post was created but no ID was returned",
        ctx.requestId,
      );
    }

    const { data: postRows, error: rowLookupError } = await runQuery(
      db
        .select()
        .from(scheduled_posts)
        .where(eq(scheduled_posts.id, createdPostId))
        .limit(1),
    );
    const postRow = postRows?.[0];
    if (rowLookupError || !postRow) {
      console.error(
        `[v1/posts POST] created row lookup failed for id=${createdPostId}:`,
        rowLookupError?.message ?? "no row",
      );
      return restErrorResponse(
        "internal_error",
        "Created post could not be retrieved",
        ctx.requestId,
      );
    }

    const scheduledPostDto = toPostDTO(postRow);
    return {
      response: NextResponse.json(scheduledPostDto, {
        status: 200,
        headers: { "x-request-id": ctx.requestId },
      }),
      auditSummary: {
        post_id: scheduledPostDto.id,
        scheduled: true,
        platform: scheduledPostDto.platform,
        batch_id: scheduledPostDto.batch_id,
      },
    };
  },
});

export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.posts.list",
  handler: async (ctx, request) => {
    const queryObject = Object.fromEntries(
      new URL(request.url).searchParams,
    );
    const queryParseResult = PostListQuerySchema.safeParse(queryObject);
    if (!queryParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Query parameters failed validation",
        ctx.requestId,
        { issues: queryParseResult.error.issues },
      );
    }
    const query = queryParseResult.data;

    const { data: fetchedRows, error: queryError } = await runQuery(
      db
        .select()
        .from(scheduled_posts)
        .where(
          and(
            eq(scheduled_posts.principal_id, ctx.principal.principalId),
            query.status ? eq(scheduled_posts.status, query.status) : undefined,
            query.platform
              ? eq(scheduled_posts.platform, query.platform)
              : undefined,
            query.batch_id
              ? eq(scheduled_posts.batch_id, query.batch_id)
              : undefined,
            rowsAfter(scheduled_posts.created_at, scheduled_posts.id, query.cursor),
          ),
        )
        .orderBy(...newestFirst(scheduled_posts.created_at, scheduled_posts.id))
        .limit(query.limit + 1),
    );
    if (queryError) {
      console.error(
        `[v1/posts GET] list query failed (request_id=${ctx.requestId}):`,
        queryError.message,
      );
      return restErrorResponse(
        "internal_error",
        "Posts query failed",
        ctx.requestId,
      );
    }

    const { pageRows, nextCursor, hasMore } = toListPage(
      fetchedRows,
      query.limit,
      (postRow) => postRow.created_at,
    );

    const postDtos = pageRows.map(toPostDTO);

    return {
      response: NextResponse.json(
        { data: postDtos, next_cursor: nextCursor },
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: { count: postDtos.length, has_more: hasMore },
    };
  },
});
