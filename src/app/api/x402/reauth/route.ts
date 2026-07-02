import "server-only";

import type { NextRequest } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";

import { x402PaidEndpoint } from "@/lib/x402/middleware/x402PaidEndpoint";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { buildOAuthUrl } from "@/lib/x402/connect/buildOAuthUrl";
import { generateOAuthState } from "@/lib/x402/oauth/state";
import { issueConnectionToken } from "@/lib/x402/oauth/connectionToken";
import {
  CONNECTION_TOKEN_GRACE_MS,
  OAUTH_EXPIRY_MINUTES,
  getOAuthRedirectUri,
  isX402Platform,
} from "@/lib/x402/config";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/x402/reauth
 *
 * Pays connect_account. Re-authenticates an expired social connection.
 * Steps:
 * 1. Parse body (social_account_id).
 * 2. x402 middleware handles auth, payment, charge.
 * 3. Verify social_account_id belongs to the wallet principal.
 * 4. Verify the connection is expired (is_available=false).
 * 5. Mint a new OAuth URL and insert a social_connections row.
 * 6. Return the OAuth URL plus a connection token for /oauth/status polling.
 */

const ReauthBodySchema = z.object({
  social_account_id: z.string().uuid(),
});

type ReauthBody = z.infer<typeof ReauthBodySchema>;

type ReauthResult = {
  connectionId: string;
  platform: string;
  oauthUrl: string;
  connectionToken: string;
  expiresAt: string;
};

export const POST = x402PaidEndpoint<ReauthBody, ReauthResult>({
  endpointPath: "/api/x402/reauth",
  rateLimitScope: "x402:reauth",
  rateLimitPerMinute: 10,

  parseBody: async (req: NextRequest) => {
    try {
      const json = await req.json();
      const parsed = ReauthBodySchema.safeParse(json);
      if (!parsed.success) {
        return {
          success: false,
          httpStatus: 400,
          errorKind: "validation_error",
          message: parsed.error.issues.map((i) => i.message).join("; "),
        };
      }
      return { success: true, data: parsed.data };
    } catch {
      return {
        success: false,
        httpStatus: 400,
        errorKind: "invalid_json",
        message: "Request body must be valid JSON.",
      };
    }
  },

  resolveAction: () => ({ success: true, action: "connect_account" }),

  handler: async ({ body, principal, chargeId }) => {
    // Verify the social account belongs to this wallet principal.
    const { data: account, error: accountError } = await adminSupabase
      .from("social_accounts")
      .select("id, platform, principal_id, is_available")
      .eq("id", body.social_account_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (accountError || !account) {
      return {
        success: false,
        errorKind: "account_not_found",
        message: "Social account not found.",
        refundable: true,
      };
    }

    if (account.principal_id !== principal.principalId) {
      return {
        success: false,
        errorKind: "ownership_mismatch",
        message: "Social account does not belong to this wallet.",
        refundable: true,
      };
    }

    // Verify the account needs re-auth (is_available=false means the token expired).
    if (account.is_available) {
      return {
        success: false,
        errorKind: "reauth_not_needed",
        message: "Account is already available. Re-authentication not required.",
        refundable: true,
      };
    }

    // The DB platform union is wider than the x402 subset (facebook,
    // youtube, ...); accounts outside the subset have no x402 OAuth flow.
    const platform = account.platform;
    if (!isX402Platform(platform)) {
      return {
        success: false,
        errorKind: "unsupported_platform",
        message: `Platform "${platform}" is not supported for x402 re-authentication.`,
        refundable: true,
      };
    }

    const connectionId = randomUUID();
    const oauthState = generateOAuthState();
    const expiresAt = new Date(Date.now() + OAUTH_EXPIRY_MINUTES * 60 * 1000).toISOString();

    const redirectUri = getOAuthRedirectUri(platform);
    if (!redirectUri) {
      return {
        success: false,
        errorKind: "redirect_uri_not_configured",
        message: `Redirect URI not configured for platform "${platform}".`,
        refundable: true,
      };
    }

    const oauthResult = buildOAuthUrl({ platform, state: oauthState, redirectUri });
    if (!oauthResult.ok) {
      return {
        success: false,
        errorKind: "oauth_url_build_failed",
        message: oauthResult.message,
        refundable: true,
      };
    }

    // Insert social_connections row for tracking the OAuth flow. The PKCE
    // verifier is non-null only for platforms that mandate PKCE (X).
    const { error: insertError } = await adminSupabase
      .from("social_connections")
      .insert({
        id: connectionId,
        principal_id: principal.principalId,
        initiated_via: "x402",
        initiated_x402_charge_id: chargeId,
        platform,
        oauth_state: oauthState,
        oauth_code_verifier: oauthResult.codeVerifier,
        redirect_uri: redirectUri,
        status: "pending",
        expires_at: expiresAt,
      });

    if (insertError) {
      return {
        success: false,
        errorKind: "db_insert_failed",
        message: "Failed to create re-auth connection record.",
        refundable: true,
      };
    }

    // Without a token the agent cannot poll /oauth/status for the
    // connection it just paid for, so a token failure is refundable too.
    const tokenResult = issueConnectionToken({
      connectionId,
      walletAddress: principal.address,
      chargeId,
      iat: Date.now(),
      exp: new Date(expiresAt).getTime() + CONNECTION_TOKEN_GRACE_MS,
      platform,
    });
    if (!tokenResult.ok) {
      return {
        success: false,
        errorKind: "token_issue_failed",
        message: "Failed to issue the connection token.",
        refundable: true,
      };
    }

    return {
      success: true,
      data: {
        connectionId,
        platform,
        oauthUrl: oauthResult.url,
        connectionToken: tokenResult.token,
        expiresAt,
      },
    };
  },
});
