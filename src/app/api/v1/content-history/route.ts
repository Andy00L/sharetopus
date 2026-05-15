import { NextResponse } from "next/server";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { toContentHistoryDTO } from "@/lib/api/rest/dto/toContentHistoryDTO";
import { ContentHistoryQuerySchema } from "@/lib/api/rest/validation/analyticsSchemas";
import { adminSupabase } from "@/actions/api/adminSupabase";

/**
 * GET /v1/content-history -- list published content history.
 *
 * Queries content_history directly (same table the shared
 * getContentHistory helper reads). Direct query here because
 * the helper joins social_accounts for avatar_url which the
 * REST DTO does not expose, and has its own rate limiting.
 * Cursor pagination on created_at.
 */
export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.content_history.list",
  handler: async (ctx, request) => {
    // Step 1: parse query string.
    const queryObject = Object.fromEntries(
      new URL(request.url).searchParams,
    );
    const queryParseResult =
      ContentHistoryQuerySchema.safeParse(queryObject);
    if (!queryParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Query parameters failed validation",
        ctx.requestId,
        { issues: queryParseResult.error.issues },
      );
    }
    const query = queryParseResult.data;

    // Step 2: build query scoped to principal.
    let contentQuery = adminSupabase
      .from("content_history")
      .select("*")
      .eq("principal_id", ctx.principal.principalId)
      .order("created_at", { ascending: false })
      .limit(query.limit + 1);

    if (query.platform) {
      contentQuery = contentQuery.eq("platform", query.platform);
    }
    if (query.cursor) {
      contentQuery = contentQuery.lt("created_at", query.cursor);
    }

    const { data: rows, error: queryError } = await contentQuery;
    if (queryError) {
      console.error(
        `[v1/content-history GET] query failed (request_id=${ctx.requestId}):`,
        queryError.message,
      );
      return restErrorResponse(
        "internal_error",
        "Content history query failed",
        ctx.requestId,
      );
    }

    // Step 3: compute pagination.
    const fetchedRows = rows ?? [];
    const hasMore = fetchedRows.length > query.limit;
    const pagedRows = hasMore
      ? fetchedRows.slice(0, query.limit)
      : fetchedRows;
    const nextCursor = hasMore
      ? pagedRows[pagedRows.length - 1].created_at
      : null;

    const contentDtos = pagedRows.map(toContentHistoryDTO);

    return {
      response: NextResponse.json(
        { data: contentDtos, next_cursor: nextCursor },
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        count: contentDtos.length,
        platform: query.platform ?? null,
      },
    };
  },
});
