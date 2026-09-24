import { and, desc, eq, gte, lt } from "drizzle-orm";
import { NextResponse } from "next/server";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { toAnalyticsDTO } from "@/lib/api/rest/dto/toAnalyticsDTO";
import { AnalyticsQuerySchema } from "@/lib/api/rest/validation/analyticsSchemas";
import { db, runQuery } from "@/db/client";
import { analytics_metrics } from "@/db/schema";

/**
 * GET /v1/analytics -- account-wide analytics metrics.
 *
 * Mirrors the MCP get_account_analytics query shape: reads
 * analytics_metrics filtered by principal, platform, content_id,
 * and lookback days. Cursor pagination on metric_date.
 *
 * Note: analytics_metrics is not currently populated by any cron.
 * Endpoints ship and return data:[] until the analytics pipeline
 * is built (separate phase).
 */
export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.analytics.list",
  handler: async (ctx, request) => {
    // Step 1: parse query string.
    const queryObject = Object.fromEntries(
      new URL(request.url).searchParams,
    );
    const queryParseResult = AnalyticsQuerySchema.safeParse(queryObject);
    if (!queryParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Query parameters failed validation",
        ctx.requestId,
        { issues: queryParseResult.error.issues },
      );
    }
    const query = queryParseResult.data;

    // Step 2: compute lookback date (same logic as MCP tool).
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - query.days);
    const sinceIsoDate = sinceDate.toISOString().split("T")[0];

    // Step 3: query scoped to principal. and() skips the optional filters
    // left undefined.
    const { data: fetchedRows, error: queryError } = await runQuery(
      db
        .select()
        .from(analytics_metrics)
        .where(
          and(
            eq(analytics_metrics.principal_id, ctx.principal.principalId),
            gte(analytics_metrics.metric_date, sinceIsoDate),
            query.platform
              ? eq(analytics_metrics.platform, query.platform)
              : undefined,
            query.content_id
              ? eq(analytics_metrics.content_id, query.content_id)
              : undefined,
            query.cursor
              ? lt(analytics_metrics.metric_date, query.cursor)
              : undefined,
          ),
        )
        .orderBy(desc(analytics_metrics.metric_date))
        .limit(query.limit + 1),
    );
    if (queryError) {
      console.error(
        `[v1/analytics GET] query failed (request_id=${ctx.requestId}):`,
        queryError.message,
      );
      return restErrorResponse(
        "internal_error",
        "Analytics query failed",
        ctx.requestId,
      );
    }

    // Step 4: compute pagination.
    const hasMore = fetchedRows.length > query.limit;
    const pagedRows = hasMore
      ? fetchedRows.slice(0, query.limit)
      : fetchedRows;
    const nextCursor = hasMore
      ? pagedRows[pagedRows.length - 1].metric_date
      : null;

    const analyticsDtos = pagedRows.map(toAnalyticsDTO);

    return {
      response: NextResponse.json(
        { data: analyticsDtos, next_cursor: nextCursor },
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        count: analyticsDtos.length,
        days: query.days,
        platform: query.platform ?? null,
      },
    };
  },
});
