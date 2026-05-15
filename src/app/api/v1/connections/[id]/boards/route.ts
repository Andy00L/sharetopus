import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { toPinterestBoardDTO } from "@/lib/api/rest/dto/toPinterestBoardDTO";
import { PinterestBoardsQuerySchema } from "@/lib/api/rest/validation/connectionSchemas";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { getPinterestBoards } from "@/lib/api/pinterest/data/getPinterestBoards";
import { adminSupabase } from "@/actions/api/adminSupabase";
import type { SocialAccount } from "@/lib/types/dbTypes";

const ConnectionIdSchema = z.string().uuid();

/**
 * GET /v1/connections/[id]/boards -- list Pinterest boards.
 *
 * 400 if the account is not Pinterest. 401 with reauth_url if the
 * Pinterest token has expired and cannot be refreshed. Reuses
 * ensureValidToken and getPinterestBoards (same chain MCP uses).
 */
export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.connections.boards",
  handler: async (ctx, request) => {
    // Step 1: extract connection ID from URL path.
    // Path is /v1/connections/[id]/boards, so id is second-to-last.
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

    // Step 2: parse query params.
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

    // Step 3: fetch account scoped to principal + platform=pinterest.
    const { data: pinterestAccount, error: lookupError } =
      await adminSupabase
        .from("social_accounts")
        .select(
          "id, platform, principal_id, access_token, refresh_token, token_expires_at",
        )
        .eq("id", connectionId)
        .eq("principal_id", ctx.principal.principalId)
        .is("deleted_at", null)
        .maybeSingle();

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
    if (!pinterestAccount) {
      return restErrorResponse(
        "not_found",
        "Connection not found",
        ctx.requestId,
      );
    }

    // Step 4: reject non-Pinterest accounts.
    if (pinterestAccount.platform !== "pinterest") {
      return restErrorResponse(
        "validation_error",
        "Boards are only available for Pinterest accounts",
        ctx.requestId,
      );
    }

    // Step 5: ensure token is fresh (refresh if expired).
    const tokenRefreshResult = await ensureValidToken(
      pinterestAccount as SocialAccount,
    );
    if (!tokenRefreshResult.success || !tokenRefreshResult.token) {
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

    // Step 6: fetch boards via shared Pinterest helper.
    const boardsResult = await getPinterestBoards(
      tokenRefreshResult.token,
      ctx.principal.principalId,
      { pageSize: query.page_size, bookmark: query.bookmark },
    );

    if (!boardsResult.success) {
      if (boardsResult.expired) {
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
      return restErrorResponse(
        "internal_error",
        "Failed to fetch Pinterest boards",
        ctx.requestId,
      );
    }

    const boardDtos = boardsResult.boards.map(toPinterestBoardDTO);

    return {
      response: NextResponse.json(
        {
          data: boardDtos,
          bookmark: boardsResult.bookmark ?? null,
        },
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        connection_id: connectionId,
        board_count: boardDtos.length,
      },
    };
  },
});
