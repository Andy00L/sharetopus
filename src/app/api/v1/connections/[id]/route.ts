import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { toConnectionDTO } from "@/lib/api/rest/dto/toConnectionDTO";
import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";

const ConnectionIdSchema = z.guid();

/**
 * GET /v1/connections/[id] -- fetch a single connected social account.
 *
 * Principal-scoped. 404 if not owned or deleted.
 */
export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.connections.get",
  handler: async (ctx, request) => {
    // Step 1: extract and validate connection ID from URL path.
    const urlSegments = new URL(request.url).pathname.split("/");
    const idCandidate = urlSegments[urlSegments.length - 1] ?? "";

    const idParseResult = ConnectionIdSchema.safeParse(idCandidate);
    if (!idParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Invalid connection id format",
        ctx.requestId,
      );
    }
    const connectionId = idParseResult.data;

    // Step 2: fetch row scoped to calling principal.
    const { data: accountRows, error: lookupError } = await runQuery(
      db
        .select()
        .from(social_accounts)
        .where(
          and(
            eq(social_accounts.id, connectionId),
            eq(social_accounts.principal_id, ctx.principal.principalId),
            isNull(social_accounts.deleted_at),
          ),
        )
        .limit(1),
    );

    if (lookupError) {
      console.error(
        `[v1/connections/[id] GET] lookup failed (request_id=${ctx.requestId}):`,
        lookupError.message,
      );
      return restErrorResponse(
        "internal_error",
        "Connection lookup failed",
        ctx.requestId,
      );
    }
    const accountRow = accountRows[0];
    if (!accountRow) {
      return restErrorResponse(
        "not_found",
        "Connection not found",
        ctx.requestId,
      );
    }

    const connectionDto = toConnectionDTO(accountRow);

    return {
      response: NextResponse.json(connectionDto, {
        status: 200,
        headers: { "x-request-id": ctx.requestId },
      }),
      auditSummary: {
        connection_id: connectionDto.id,
        platform: connectionDto.platform,
      },
    };
  },
});
