import { NextResponse } from "next/server";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { toConnectionDTO } from "@/lib/api/rest/dto/toConnectionDTO";
import { ConnectionListQuerySchema } from "@/lib/api/rest/validation/connectionSchemas";
import { adminSupabase } from "@/actions/api/adminSupabase";

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

    // Step 2: build Supabase query scoped to calling principal.
    let baseQuery = adminSupabase
      .from("social_accounts")
      .select("*")
      .eq("principal_id", ctx.principal.principalId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(query.limit + 1);

    // Only show available accounts by default.
    if (!query.include_unavailable) {
      baseQuery = baseQuery.eq("is_available", true);
    }
    if (query.platform) {
      baseQuery = baseQuery.eq("platform", query.platform);
    }
    if (query.cursor) {
      baseQuery = baseQuery.lt("created_at", query.cursor);
    }

    const { data: rows, error: queryError } = await baseQuery;
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
    const fetchedRows = rows ?? [];
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
