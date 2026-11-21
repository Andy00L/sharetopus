import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import {
  restErrorResponse,
  SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from "@/lib/api/rest/errors/restErrorResponse";
import { toPinterestBoardDTO } from "@/lib/api/rest/dto/toPinterestBoardDTO";
import type { PinterestBoardPage } from "@/lib/api/rest/openapi/responseSchemas";
import { PinterestBoardsQuerySchema } from "@/lib/api/rest/validation/connectionSchemas";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { getPinterestBoards } from "@/lib/api/pinterest/data/getPinterestBoards";
import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";

const ConnectionIdSchema = z.guid();

export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.connections.boards",
  handler: async (ctx, request) => {
    const urlSegments = new URL(request.url).pathname.split("/");
    const idCandidate = urlSegments[urlSegments.length - 2] ?? "";

    const idParseResult = ConnectionIdSchema.safeParse(idCandidate);
    if (!idParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Invalid connection id format",
        ctx.requestId,
      );
    }
    const connectionId = idParseResult.data;

    const queryObject = Object.fromEntries(
      new URL(request.url).searchParams,
    );
    const queryParseResult =
      PinterestBoardsQuerySchema.safeParse(queryObject);
    if (!queryParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Query parameters failed validation",
        ctx.requestId,
        { issues: queryParseResult.error.issues },
      );
    }
    const query = queryParseResult.data;

    const { data: pinterestAccounts, error: lookupError } = await runQuery(
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
        `[v1/connections/[id]/boards GET] lookup failed (request_id=${ctx.requestId}):`,
        lookupError.message,
      );
      return restErrorResponse(
        "internal_error",
        "Connection lookup failed",
        ctx.requestId,
      );
    }
    const pinterestAccount = pinterestAccounts[0];
    if (!pinterestAccount) {
      return restErrorResponse(
        "not_found",
        "Connection not found",
        ctx.requestId,
      );
    }

    if (pinterestAccount.platform !== "pinterest") {
      return restErrorResponse(
        "validation_error",
        "Boards are only available for Pinterest accounts",
        ctx.requestId,
      );
    }

    const tokenRefreshResult = await ensureValidToken(pinterestAccount);
    if (!tokenRefreshResult.success) {
      switch (tokenRefreshResult.failureReason) {
        case "transient":
          return restErrorResponse(
            "service_unavailable",
            "Could not refresh the Pinterest token right now. Retry shortly.",
            ctx.requestId,
            { retry_after_seconds: SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS },
          );
        case "auth_expired": {
          const baseUrl =
            process.env.NEXT_PUBLIC_BASE_URL ?? "https://sharetopus.com";
          return restErrorResponse(
            "unauthorized",
            "Pinterest token expired and could not be refreshed",
            ctx.requestId,
            {
              reauth_url: `${baseUrl}/api/v1/connections/${connectionId}/reauth`,
            },
          );
        }
        default: {
          const unhandledFailureReason: never = tokenRefreshResult.failureReason;
          return restErrorResponse(
            "internal_error",
            `Unexpected token failure ${String(unhandledFailureReason)}`,
            ctx.requestId,
          );
        }
      }
    }

    const boardsResult = await getPinterestBoards(
      tokenRefreshResult.token,
      ctx.principal.principalId,
      { pageSize: query.page_size, bookmark: query.bookmark },
    );

    if (!boardsResult.success) {
      switch (boardsResult.failure) {
        case "token_expired": {
          const baseUrl =
            process.env.NEXT_PUBLIC_BASE_URL ?? "https://sharetopus.com";
          return restErrorResponse(
            "unauthorized",
            "Pinterest token is no longer valid",
            ctx.requestId,
            {
              reauth_url: `${baseUrl}/api/v1/connections/${connectionId}/reauth`,
            },
          );
        }
        case "rate_limited":
          return restErrorResponse(
            "rate_limited",
            "Too many Pinterest board requests. Retry shortly.",
            ctx.requestId,
            { retry_after_seconds: boardsResult.resetIn ?? null },
          );
        case "unavailable":
          return restErrorResponse(
            "service_unavailable",
            "Could not check the rate limit right now. Retry shortly.",
            ctx.requestId,
            { retry_after_seconds: SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS },
          );
        case "token_missing":
        case "upstream_error":
          return restErrorResponse(
            "internal_error",
            "Failed to fetch Pinterest boards",
            ctx.requestId,
          );
      }
    }

    const boardDtos = boardsResult.boards.map(toPinterestBoardDTO);

    return {
      response: NextResponse.json(
        {
          data: boardDtos,
          bookmark: boardsResult.bookmark,
        } satisfies PinterestBoardPage,
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        connection_id: connectionId,
        board_count: boardDtos.length,
      },
    };
  },
});
