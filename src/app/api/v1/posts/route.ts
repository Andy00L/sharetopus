import { and, desc, eq, lt } from "drizzle-orm";
import { NextResponse } from "next/server";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import {
  PostCreateInputSchema,
  PostListQuerySchema,
} from "@/lib/api/rest/validation/schemas";
import {
  restInputToSchedulePostData,
  restInputToDirectPostData,
} from "@/lib/api/rest/adapters/restInputToScheduledPost";
import { toPostDTO } from "@/lib/api/rest/dto/toPostDTO";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { schedulePostBatch } from "@/actions/server/scheduleActions/schedule/schedulePostBatch";
import { directPostBatch } from "@/actions/server/directPostActions/directPostBatch";
import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";

/**
 * POST /v1/posts -- create a single post.
 *
 * scheduled_at omitted -> directPostBatch (publishes immediately).
 * scheduled_at provided -> schedulePostBatch.
 *
 * Returns 200 with PostDTO on success, 400 on Zod validation failure,
 * 500 on unexpected DB errors.
 */
export const POST = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.posts.create",
  handler: async (ctx, request) => {
    // Step 1: parse JSON body. Reject malformed cleanly.
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

    // Step 2: Zod validate. Map issues to standard validation_error.
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

    // Step 3: dispatch to correct batch function.
    const isDirectPost = !validatedInput.scheduled_at;

    if (isDirectPost) {
      // Immediate publish path via directPostBatch.
      const directPostInput = restInputToDirectPostData(validatedInput);
      const batchResult = await directPostBatch(
        [directPostInput],
        ctx.principal.principalId,
        "api",
        undefined,
        ctx.requestId,
      );

      if (!batchResult.success) {
        const firstRejection = batchResult.details?.rejected?.[0];
        const failureMessage =
          firstRejection?.reason ?? batchResult.message;
        return restErrorResponse(
          "internal_error",
          failureMessage,
          ctx.requestId,
        );
      }

      // directPostBatch returns eventIds, not post IDs. Look up the
      // created row by batch_id + principal_id.
      const { data: postRows, error: rowLookupError } = await runQuery(
        db
          .select()
          .from(scheduled_posts)
          .where(
            and(
              eq(scheduled_posts.batch_id, batchResult.batchId),
              eq(scheduled_posts.principal_id, ctx.principal.principalId),
            ),
          )
          .orderBy(desc(scheduled_posts.created_at))
          .limit(1),
      );

      const postRow = postRows?.[0];
      if (rowLookupError || !postRow) {
        console.error(
          `[v1/posts POST] direct post row lookup failed for batch_id=${batchResult.batchId}:`,
          rowLookupError?.message ?? "no row",
        );
        return restErrorResponse(
          "internal_error",
          "Created post could not be retrieved",
          ctx.requestId,
        );
      }

      const directPostDto = toPostDTO(postRow);
      return {
        response: NextResponse.json(directPostDto, {
          status: 200,
          headers: { "x-request-id": ctx.requestId },
        }),
        auditSummary: {
          post_id: directPostDto.id,
          scheduled: false,
          platform: directPostDto.platform,
          batch_id: directPostDto.batch_id,
        },
      };
    }

    // Scheduled path via schedulePostBatch.
    const schedulePostInput = restInputToSchedulePostData(validatedInput);
    const batchResult = await schedulePostBatch(
      [schedulePostInput],
      ctx.principal.principalId,
      "api",
      ctx.requestId,
    );

    if (!batchResult.success) {
      const firstRejection = batchResult.details?.rejected?.[0];
      const failureMessage =
        firstRejection?.reason ?? batchResult.message;
      return restErrorResponse(
        "internal_error",
        failureMessage,
        ctx.requestId,
      );
    }

    // schedulePostBatch returns scheduleIds which are scheduled_posts.id.
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

/**
 * GET /v1/posts -- paginated list, principal-scoped.
 *
 * Query: status, platform, batch_id, limit (1-100, default 20),
 * cursor (created_at of last item in previous page).
 */
export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.posts.list",
  handler: async (ctx, request) => {
    // Step 1: parse query string.
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

    // Step 2: query scoped to calling principal. and() skips the optional
    // filters left undefined.
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
            query.cursor
              ? lt(scheduled_posts.created_at, query.cursor)
              : undefined,
          ),
        )
        .orderBy(desc(scheduled_posts.created_at))
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

    // Step 3: compute pagination cursor. Over-fetch by 1 to detect
    // more pages; the extra row never appears in the response payload.
    const hasMore = fetchedRows.length > query.limit;
    const pagedRows = hasMore
      ? fetchedRows.slice(0, query.limit)
      : fetchedRows;
    const nextCursor = hasMore
      ? pagedRows[pagedRows.length - 1].created_at
      : null;

    const postDtos = pagedRows.map(toPostDTO);

    return {
      response: NextResponse.json(
        { data: postDtos, next_cursor: nextCursor },
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: { count: postDtos.length, has_more: hasMore },
    };
  },
});
