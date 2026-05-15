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
import { adminSupabase } from "@/actions/api/adminSupabase";

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
      const { data: postRow, error: rowLookupError } = await adminSupabase
        .from("scheduled_posts")
        .select("*")
        .eq("batch_id", batchResult.batchId)
        .eq("principal_id", ctx.principal.principalId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

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

    const { data: postRow, error: rowLookupError } = await adminSupabase
      .from("scheduled_posts")
      .select("*")
      .eq("id", createdPostId)
      .single();
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

    // Step 2: build Supabase query scoped to calling principal.
    let baseQuery = adminSupabase
      .from("scheduled_posts")
      .select("*")
      .eq("principal_id", ctx.principal.principalId)
      .order("created_at", { ascending: false })
      .limit(query.limit + 1);

    if (query.status) baseQuery = baseQuery.eq("status", query.status);
    if (query.platform)
      baseQuery = baseQuery.eq("platform", query.platform);
    if (query.batch_id)
      baseQuery = baseQuery.eq("batch_id", query.batch_id);
    if (query.cursor)
      baseQuery = baseQuery.lt("created_at", query.cursor);

    const { data: rows, error: queryError } = await baseQuery;
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
    const fetchedRows = rows ?? [];
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
