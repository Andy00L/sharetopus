import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { ConnectionInitiateInputSchema } from "@/lib/api/rest/validation/connectionSchemas";
import { buildOAuthUrl } from "@/lib/x402/connect/buildOAuthUrl";
import { generateOAuthState } from "@/lib/x402/oauth/state";
import { adminSupabase } from "@/actions/api/adminSupabase";
import type { Platform } from "@/lib/x402/connect/types";

const OAUTH_EXPIRY_MINUTES = 15;

/**
 * POST /v1/connections/initiate -- start an OAuth flow.
 *
 * Creates a social_connections row with initiated_via='api' and
 * returns the OAuth authorization URL. The user must visit the URL
 * in their browser to authorize. On success the provider redirects
 * to /api/oauth/callback/[platform] which completes the flow via
 * handleOAuthCallback (state-based lookup, no cookies needed).
 */
export const POST = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.connections.initiate",
  handler: async (ctx, request) => {
    // Step 1: parse and validate request body.
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return restErrorResponse(
        "validation_error",
        "Request body is not valid JSON",
        ctx.requestId,
      );
    }

    const bodyParseResult = ConnectionInitiateInputSchema.safeParse(rawBody);
    if (!bodyParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Request body failed validation",
        ctx.requestId,
        { issues: bodyParseResult.error.issues },
      );
    }
    const validatedInput = bodyParseResult.data;
    const platform = validatedInput.platform as Platform;

    // Step 2: build the OAuth redirect URI for the shared callback.
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ?? "https://sharetopus.com";
    const redirectUri =
      validatedInput.redirect_url ??
      `${baseUrl}/api/oauth/callback/${platform}`;

    // Step 3: generate OAuth state and build the authorization URL.
    const oauthState = generateOAuthState();
    const oauthResult = buildOAuthUrl({
      platform,
      state: oauthState,
      redirectUri,
    });

    if (!oauthResult.ok) {
      console.error(
        `[v1/connections/initiate POST] buildOAuthUrl failed:`,
        oauthResult.message,
      );
      return restErrorResponse(
        "internal_error",
        "Failed to build OAuth URL",
        ctx.requestId,
      );
    }

    // Step 4: create social_connections row for state-based callback lookup.
    const expiresAt = new Date(
      Date.now() + OAUTH_EXPIRY_MINUTES * 60 * 1000,
    ).toISOString();

    const connectionId = randomUUID();

    const { data: connectionRow, error: insertError } = await adminSupabase
      .from("social_connections")
      .insert({
        id: connectionId,
        principal_id: ctx.principal.principalId,
        initiated_via: "api",
        platform,
        oauth_state: oauthState,
        redirect_uri: redirectUri,
        status: "pending",
        expires_at: expiresAt,
        metadata: {
          source: "rest_api",
          request_id: ctx.requestId,
        },
      })
      .select("id")
      .single();

    if (insertError || !connectionRow) {
      console.error(
        `[v1/connections/initiate POST] social_connections insert failed (request_id=${ctx.requestId}):`,
        insertError?.message ?? "no row returned",
      );
      return restErrorResponse(
        "internal_error",
        "Failed to create connection record",
        ctx.requestId,
      );
    }

    return {
      response: NextResponse.json(
        {
          connect_url: oauthResult.url,
          state: oauthState,
          expires_at: expiresAt,
          connection_id: connectionRow.id,
        },
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        platform,
        connection_id: connectionRow.id,
      },
    };
  },
});
