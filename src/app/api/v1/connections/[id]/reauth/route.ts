import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { toConnectionDTO } from "@/lib/api/rest/dto/toConnectionDTO";
import { buildOAuthUrl } from "@/lib/x402/connect/buildOAuthUrl";
import { generateOAuthState } from "@/lib/x402/oauth/state";
import { adminSupabase } from "@/actions/api/adminSupabase";
import type { Platform } from "@/lib/x402/connect/types";

const ConnectionIdSchema = z.guid();
const OAUTH_EXPIRY_MINUTES = 15;

/**
 * POST /v1/connections/[id]/reauth -- get a real OAuth reauth URL.
 *
 * Generates a fresh OAuth authorization URL for the account and
 * creates a social_connections row for the state-based callback.
 * Unlike the MCP tool (which returns a generic /connections page),
 * this endpoint returns a direct reauth URL the caller can use.
 */
export const POST = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.connections.reauth",
  handler: async (ctx, request) => {
    // Step 1: extract and validate connection ID from URL path.
    const urlSegments = new URL(request.url).pathname.split("/");
    // Path is /v1/connections/[id]/reauth, so id is second-to-last.
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

    // Step 2: fetch account scoped to principal.
    const { data: accountRow, error: lookupError } = await adminSupabase
      .from("social_accounts")
      .select("*")
      .eq("id", connectionId)
      .eq("principal_id", ctx.principal.principalId)
      .is("deleted_at", null)
      .maybeSingle();

    if (lookupError) {
      console.error(
        `[v1/connections/[id]/reauth POST] lookup failed (request_id=${ctx.requestId}):`,
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

    const platform = accountRow.platform as Platform;

    // Step 3: build OAuth URL for reauth.
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ?? "https://sharetopus.com";
    const redirectUri = `${baseUrl}/api/oauth/callback/${platform}`;
    const oauthState = generateOAuthState();

    const oauthResult = buildOAuthUrl({
      platform,
      state: oauthState,
      redirectUri,
    });

    if (!oauthResult.ok) {
      console.error(
        `[v1/connections/[id]/reauth POST] buildOAuthUrl failed:`,
        oauthResult.message,
      );
      return restErrorResponse(
        "internal_error",
        "Failed to build reauth URL",
        ctx.requestId,
      );
    }

    // Step 4: create social_connections row for state-based callback.
    const expiresAt = new Date(
      Date.now() + OAUTH_EXPIRY_MINUTES * 60 * 1000,
    ).toISOString();

    const { error: insertError } = await adminSupabase
      .from("social_connections")
      .insert({
        id: randomUUID(),
        principal_id: ctx.principal.principalId,
        initiated_via: "api",
        platform,
        oauth_state: oauthState,
        redirect_uri: redirectUri,
        status: "pending",
        expires_at: expiresAt,
        metadata: {
          source: "rest_api_reauth",
          request_id: ctx.requestId,
          reauth_for_account_id: connectionId,
        },
      });

    if (insertError) {
      console.error(
        `[v1/connections/[id]/reauth POST] social_connections insert failed (request_id=${ctx.requestId}):`,
        insertError.message,
      );
      return restErrorResponse(
        "internal_error",
        "Failed to create reauth record",
        ctx.requestId,
      );
    }

    return {
      response: NextResponse.json(
        {
          reauth_url: oauthResult.url,
          account: toConnectionDTO(accountRow),
        },
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        connection_id: connectionId,
        platform,
      },
    };
  },
});
