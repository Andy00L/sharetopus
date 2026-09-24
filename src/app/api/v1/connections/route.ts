import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { NextResponse } from "next/server";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { toConnectionDTO } from "@/lib/api/rest/dto/toConnectionDTO";
import { ConnectionListQuerySchema } from "@/lib/api/rest/validation/connectionSchemas";
import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";

/**
 * GET /v1/connections -- list connected social accounts.
 *
 * Principal-scoped. Tokens stripped via toConnectionDTO.
 * Cursor pagination on created_at.
 */
export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.connections.list",
  handler: async (ctx, request) => {
    // Step 1: parse query string.
    const queryObject = Object.fromEntries(
      new URL(request.url).searchParams,
    );
    const queryParseResult = ConnectionListQuerySchema.safeParse(queryObject);
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
    // filters left undefined; unavailable accounts are hidden by default.
    const { data: fetchedRows, error: queryError } = await runQuery(
      db
        .select()
        .from(social_accounts)
        .where(
          and(
            eq(social_accounts.principal_id, ctx.principal.principalId),
            isNull(social_accounts.deleted_at),
            query.include_unavailable
              ? undefined
              : eq(social_accounts.is_available, true),
            query.platform
              ? eq(social_accounts.platform, query.platform)
              : undefined,
            query.cursor
              ? lt(social_accounts.created_at, query.cursor)
              : undefined,
          ),
        )
        .orderBy(desc(social_accounts.created_at))
        .limit(query.limit + 1),
    );
    if (queryError) {
      console.error(
        `[v1/connections GET] list query failed (request_id=${ctx.requestId}):`,
        queryError.message,
      );
      return restErrorResponse(
        "internal_error",
        "Connections query failed",
        ctx.requestId,
      );
    }

    // Step 3: compute pagination cursor.
    const hasMore = fetchedRows.length > query.limit;
    const pagedRows = hasMore
      ? fetchedRows.slice(0, query.limit)
      : fetchedRows;
    const nextCursor = hasMore
      ? pagedRows[pagedRows.length - 1].created_at
      : null;

    const connectionDtos = pagedRows.map(toConnectionDTO);

    return {
      response: NextResponse.json(
        { data: connectionDtos, next_cursor: nextCursor },
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: { count: connectionDtos.length },
    };
  },
});
