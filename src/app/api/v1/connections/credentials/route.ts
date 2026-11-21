import { NextResponse } from "next/server";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { CredentialsConnectInputSchema } from "@/lib/api/rest/validation/connectionSchemas";
import type {
  CredentialConnectResult,
  CredentialProviderList,
} from "@/lib/api/rest/openapi/responseSchemas";
import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import {
  listAvailableProviders,
  resolveConfiguredProvider,
} from "@/lib/platforms/providers/registry";

export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.connections.credentials.list",
  handler: async (ctx) => {
    const providers = listAvailableProviders()
      .filter((metadata) => metadata.authKind === "credentials")
      .map((metadata) => ({
        provider: metadata.id,
        label: metadata.label,
        category: metadata.category,
        fields: metadata.credentialFields.map((field) => ({
          key: field.key,
          label: field.label,
          kind: field.kind,
          required: field.required,
          placeholder: field.placeholder,
          help_text: field.helpText,
        })),
      }));

    return {
      response: NextResponse.json(
        { providers } satisfies CredentialProviderList,
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: { provider_count: providers.length },
    };
  },
});

export const POST = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.connections.credentials.create",
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

    const bodyParseResult = CredentialsConnectInputSchema.safeParse(rawBody);
    if (!bodyParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Request body failed validation",
        ctx.requestId,
        { issues: bodyParseResult.error.issues },
      );
    }
    const { provider: platformId, values } = bodyParseResult.data;

    const providerResult = resolveConfiguredProvider(platformId);
    if (!providerResult.ok) {
      return restErrorResponse(
        "internal_error",
        providerResult.message,
        ctx.requestId,
      );
    }
    const provider = providerResult.provider;
    if (provider.authKind !== "credentials") {
      return restErrorResponse(
        "validation_error",
        `${provider.label} connects through OAuth, not pasted credentials.`,
        ctx.requestId,
      );
    }

    const connectResult = await provider.connect({ values });
    if (!connectResult.ok) {
      return {
        response: restErrorResponse(
          "validation_error",
          connectResult.message,
          ctx.requestId,
        ),
        auditSummary: { provider: platformId, outcome: "verify_failed" },
      };
    }

    const tokenExpiresAt =
      connectResult.expiresIn === null
        ? null
        : new Date(Date.now() + connectResult.expiresIn * 1000).toISOString();

    const accountValues = {
      principal_id: ctx.principal.principalId,
      platform: platformId,
      account_identifier: connectResult.identity.accountIdentifier,
      is_available: true,
      display_name: connectResult.identity.displayName,
      username: connectResult.identity.username,
      avatar_url: connectResult.identity.avatarUrl,
      access_token: connectResult.accessToken,
      refresh_token: connectResult.refreshToken,
      token_expires_at: tokenExpiresAt,
      extra: connectResult.config,
      updated_at: new Date().toISOString(),
    } satisfies typeof social_accounts.$inferInsert;

    const { data: accountRows, error: upsertError } = await runQuery(
      db
        .insert(social_accounts)
        .values(accountValues)
        .onConflictDoUpdate({
          target: [
            social_accounts.principal_id,
            social_accounts.platform,
            social_accounts.account_identifier,
          ],
          set: accountValues,
        })
        .returning({ id: social_accounts.id }),
    );

    const accountRow = accountRows?.[0];
    if (upsertError || !accountRow) {
      console.error(
        `[v1/connections/credentials POST] Upsert failed (request_id=${ctx.requestId}):`,
        upsertError?.message,
      );
      return restErrorResponse(
        "internal_error",
        "Credentials verified but the connection could not be saved.",
        ctx.requestId,
      );
    }

    return {
      response: NextResponse.json(
        {
          id: accountRow.id,
          provider: platformId,
          account_identifier: connectResult.identity.accountIdentifier,
          display_name: connectResult.identity.displayName,
          username: connectResult.identity.username,
        } satisfies CredentialConnectResult,
        { status: 201, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        provider: platformId,
        social_account_id: accountRow.id,
        outcome: "connected",
      },
    };
  },
});
