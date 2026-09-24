import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import {
  newestFirst,
  rowsAfter,
  toListPage,
} from "@/lib/api/rest/pagination";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { toContentHistoryDTO } from "@/lib/api/rest/dto/toContentHistoryDTO";
import { ContentHistoryQuerySchema } from "@/lib/api/rest/validation/analyticsSchemas";
import { db, runQuery } from "@/db/client";
import { content_history } from "@/db/schema";

/**
 * GET /v1/content-history -- list published content history.
 *
 * Queries content_history directly (same table the shared
 * getContentHistory helper reads). Direct query here because
 * the helper joins social_accounts for avatar_url which the
 * REST DTO does not expose, and has its own rate limiting.
 * Keyset pagination on (created_at, id).
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

    // Step 2: query scoped to principal. and() skips the optional filters
    // left undefined.
    const { data: fetchedRows, error: queryError } = await runQuery(
      db
        .select()
        .from(content_history)
        .where(
          and(
            eq(content_history.principal_id, ctx.principal.principalId),
            query.platform
              ? eq(content_history.platform, query.platform)
              : undefined,
            rowsAfter(content_history.created_at, content_history.id, query.cursor),
          ),
        )
        .orderBy(...newestFirst(content_history.created_at, content_history.id))
        .limit(query.limit + 1),
    );
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
    const { pageRows, nextCursor } = toListPage(
      fetchedRows,
      query.limit,
      (historyRow) => historyRow.created_at,
    );

    const contentDtos = pageRows.map(toContentHistoryDTO);

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
