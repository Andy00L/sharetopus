import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { toConnectionDTO } from "@/lib/api/rest/dto/toConnectionDTO";
import { adminSupabase } from "@/actions/api/adminSupabase";

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
    const { data: accountRow, error: lookupError } = await adminSupabase
      .from("social_accounts")
      .select("*")
      .eq("id", connectionId)
      .eq("principal_id", ctx.principal.principalId)
      .is("deleted_at", null)
      .maybeSingle();

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
