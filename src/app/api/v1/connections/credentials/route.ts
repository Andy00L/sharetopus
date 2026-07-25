import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { adminSupabase } from "@/actions/api/adminSupabase";
import {
  listAvailableProviders,
  resolveConfiguredProvider,
} from "@/lib/platforms/providers/registry";
import { providerConfigToJson } from "@/lib/platforms/providers/_shared/configJson";
import type { Database } from "@/lib/types/database.types";

/**
 * Credentials-based connect surface.
 *
 *   GET  /v1/connections/credentials -> which providers can be connected
 *        this way, with their field declarations (drives any client form)
 *   POST /v1/connections/credentials -> verify the pasted credentials with
 *        the provider and store the connection
 *
 * One route serves every credentials provider because the field list comes
 * from the catalog declaration; adding a provider adds zero routes.
 *
 * Secrets discipline: the submitted values are passed to provider.connect
 * and then dropped. Only what the provider returns is stored (the posting
 * credential in access_token, config in extra), the raw form values are
 * never logged, and the response echoes identity fields only, never
 * credentials.
 */

/** Column type for social_accounts.platform, sourced from the DB types. */
type SocialAccountPlatform =
  Database["public"]["Tables"]["social_accounts"]["Insert"]["platform"];

/**
 * Credentials providers currently servable, as DB platform values. The
 * satisfies clause makes this list fail compilation if a provider id ever
 * drifts from the platform union, instead of failing at insert time.
 */
const CREDENTIAL_PLATFORM_IDS = [
  "bluesky",
  "mastodon",
  "telegram",
  "discord",
  "slack",
  "devto",
  "wordpress",
  "hashnode",
  "medium",
  "lemmy",
  "farcaster",
  "listmonk",
  "nostr",
] as const satisfies readonly SocialAccountPlatform[];

/**
 * Ceiling on submitted form entries. The largest declared field set today
 * is Listmonk's four; 20 leaves headroom while stopping a caller from
 * posting thousands of keys per request.
 */
const MAX_CREDENTIAL_VALUE_ENTRIES = 20;

const ConnectBodySchema = z.object({
  provider: z.enum(CREDENTIAL_PLATFORM_IDS),
  /** Raw form values keyed by ProviderCredentialField.key. */
  values: z
    .record(z.string().max(64), z.string().max(2048))
    .refine(
      (record) => Object.keys(record).length <= MAX_CREDENTIAL_VALUE_ENTRIES,
      { message: `At most ${MAX_CREDENTIAL_VALUE_ENTRIES} values are accepted.` },
    ),
});

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
        fields: (metadata.credentialFields ?? []).map((field) => ({
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
        { providers },
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

    const bodyParseResult = ConnectBodySchema.safeParse(rawBody);
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

    // Required-field check against the catalog declaration, so the provider
    // sees only complete input and the error names the missing field.
    for (const field of provider.credentialFields ?? []) {
      if (field.required && !(values[field.key] ?? "").trim()) {
        return restErrorResponse(
          "validation_error",
          `Field "${field.key}" is required for ${provider.label}.`,
          ctx.requestId,
        );
      }
    }

    // Verify with the provider. This talks to the live API, so bad
    // credentials are caught here, not on the first scheduled post.
    const connectResult = await provider.connect({
      kind: "credentials",
      values,
    });
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

    // Same conflict target the OAuth callback uses, so reconnecting the
    // same account updates it instead of duplicating it.
    const { data: accountRow, error: upsertError } = await adminSupabase
      .from("social_accounts")
      .upsert(
        {
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
          extra: providerConfigToJson(connectResult.config),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "principal_id, platform, account_identifier" },
      )
      .select("id")
      .single();

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
        },
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
