import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { toConnectionDTO } from "@/lib/api/rest/dto/toConnectionDTO";
import type { ConnectionReauthResult } from "@/lib/api/rest/openapi/responseSchemas";
import { buildOAuthUrl } from "@/lib/x402/connect/buildOAuthUrl";
import { generateOAuthState } from "@/lib/x402/oauth/state";
import { db, runQuery } from "@/db/client";
import { social_accounts, social_connections } from "@/db/schema";
import { isAdapterPlatform } from "@/lib/platforms/capabilities";

const ConnectionIdSchema = z.guid();
const OAUTH_EXPIRY_MINUTES = 15;

export const POST = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.connections.reauth",
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
        `[v1/connections/[id]/reauth POST] lookup failed (request_id=${ctx.requestId}):`,
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

    const platform = accountRow.platform;
    if (!isAdapterPlatform(platform)) {
      return restErrorResponse(
        "validation_error",
        `Reauth links are not available for ${platform} connections. Reconnect the account from the connections page.`,
        ctx.requestId,
      );
    }

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

    const expiresAt = new Date(
      Date.now() + OAUTH_EXPIRY_MINUTES * 60 * 1000,
    ).toISOString();

    const { error: insertError } = await runQuery(
      db.insert(social_connections).values({
        id: randomUUID(),
        principal_id: ctx.principal.principalId,
        initiated_via: "api",
        platform,
        oauth_state: oauthState,
        oauth_code_verifier: oauthResult.codeVerifier,
        redirect_uri: redirectUri,
        status: "pending",
        expires_at: expiresAt,
        metadata: {
          source: "rest_api_reauth",
          request_id: ctx.requestId,
          reauth_for_account_id: connectionId,
        },
      }),
    );

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
        } satisfies ConnectionReauthResult,
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        connection_id: connectionId,
        platform,
      },
    };
  },
});
