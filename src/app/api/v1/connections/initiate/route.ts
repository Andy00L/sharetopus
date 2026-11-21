import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { ConnectionInitiateInputSchema } from "@/lib/api/rest/validation/connectionSchemas";
import type { ConnectionInitiateResult } from "@/lib/api/rest/openapi/responseSchemas";
import { buildOAuthUrl } from "@/lib/x402/connect/buildOAuthUrl";
import { generateOAuthState } from "@/lib/x402/oauth/state";
import { db, runQuery } from "@/db/client";
import { social_connections } from "@/db/schema";

const OAUTH_EXPIRY_MINUTES = 15;

export const POST = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.connections.initiate",
  handler: async (ctx, request) => {
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
    const platform = bodyParseResult.data.platform;

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
        `[v1/connections/initiate POST] buildOAuthUrl failed:`,
        oauthResult.message,
      );
      return restErrorResponse(
        "internal_error",
        "Failed to build OAuth URL",
        ctx.requestId,
      );
    }

    const expiresAt = new Date(
      Date.now() + OAUTH_EXPIRY_MINUTES * 60 * 1000,
    ).toISOString();

    const connectionId = randomUUID();

    const { data: connectionRows, error: insertError } = await runQuery(
      db
        .insert(social_connections)
        .values({
          id: connectionId,
          principal_id: ctx.principal.principalId,
          initiated_via: "api",
          platform,
          oauth_state: oauthState,
          oauth_code_verifier: oauthResult.codeVerifier,
          redirect_uri: redirectUri,
          status: "pending",
          expires_at: expiresAt,
          metadata: {
            source: "rest_api",
            request_id: ctx.requestId,
          },
        })
        .returning({ id: social_connections.id }),
    );

    const connectionRow = connectionRows?.[0];
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
        } satisfies ConnectionInitiateResult,
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        platform,
        connection_id: connectionRow.id,
      },
    };
  },
});
