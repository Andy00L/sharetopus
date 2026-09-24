import "server-only";

import type { NextRequest } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";

import {
  x402PaidEndpoint,
  type X402Precheck,
} from "@/lib/x402/middleware/x402PaidEndpoint";
import { db, runQuery } from "@/db/client";
import { social_accounts, social_connections } from "@/db/schema";
import type { PreflightResult } from "@/lib/types/preflight";
import { updateChargeRecord } from "@/lib/x402/charges/chargeLifecycle";
import { buildOAuthUrl } from "@/lib/x402/connect/buildOAuthUrl";
import type { Platform } from "@/lib/x402/connect/types";
import { generateOAuthState } from "@/lib/x402/oauth/state";
import {
  hasConnectionTokenSecret,
  issueConnectionToken,
} from "@/lib/x402/oauth/connectionToken";
import {
  CONNECTION_TOKEN_GRACE_MS,
  OAUTH_EXPIRY_MINUTES,
  getOAuthRedirectUri,
  isX402Platform,
} from "@/lib/x402/config";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/x402/reauth
 *
 * Pays connect_account. Re-authenticates an expired social connection.
 * Steps:
 * 1. Parse body (social_account_id).
 * 2. Before settlement, check the account belongs to the paying wallet,
 *    needs re-authentication, is on an x402 platform, and that the OAuth
 *    configuration is complete; a failure here costs nothing.
 * 3. x402 middleware handles payment and the charge.
 * 4. Mint a new OAuth URL and insert a social_connections row.
 * 5. Return the OAuth URL plus a connection token for /oauth/status polling.
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

type ReauthTargetResult =
  | { ok: true; platform: Platform; redirectUri: string }
  | Extract<PreflightResult, { ok: false }>;

/**
 * The account to re-authenticate and its OAuth redirect, or why it cannot
 * be. Runs as the precheck and again inside the handler, since the account
 * can change between the two.
 */
async function loadReauthTarget(
  socialAccountId: string,
  principalId: string,
): Promise<ReauthTargetResult> {
  const { data: accountRows, error: accountError } = await runQuery(
    db
      .select({
        platform: social_accounts.platform,
        principal_id: social_accounts.principal_id,
        is_available: social_accounts.is_available,
      })
      .from(social_accounts)
      .where(and(eq(social_accounts.id, socialAccountId), isNull(social_accounts.deleted_at)))
      .limit(1),
  );

  if (accountError) {
    console.error(`[loadReauthTarget] social_accounts read failed: ${accountError.message}`);
    return { ok: false, httpStatus: 500, errorKind: "precheck_failed", message: "Could not look up the social account." };
  }
  const account = accountRows[0];
  if (!account) {
    return { ok: false, httpStatus: 404, errorKind: "account_not_found", message: "Social account not found." };
  }
  if (account.principal_id !== principalId) {
    return {
      ok: false,
      httpStatus: 403,
      errorKind: "ownership_mismatch",
      message: "Social account does not belong to this wallet.",
    };
  }
  if (account.is_available) {
    return {
      ok: false,
      httpStatus: 409,
      errorKind: "reauth_not_needed",
      message: "Account is already available. Re-authentication not required.",
    };
  }

  // Only the x402 platforms have x402 OAuth redirect URIs.
  const platform = account.platform;
  if (!isX402Platform(platform)) {
    return {
      ok: false,
      httpStatus: 400,
      errorKind: "unsupported_platform",
      message: `Platform "${platform}" is not supported for x402 re-authentication.`,
    };
  }

  const redirectUri = getOAuthRedirectUri(platform);
  if (!redirectUri) {
    return {
      ok: false,
      httpStatus: 500,
      errorKind: "redirect_uri_not_configured",
      message: `Redirect URI not configured for platform "${platform}".`,
    };
  }

  return { ok: true, platform, redirectUri };
}

/**
 * Everything that can fail on configuration or account state, checked
 * before settlement: the HMAC secret, the account, and a probe OAuth URL
 * build (buildOAuthUrl only reads env and pure inputs, so a missing client
 * id is caught here instead of after the charge).
 */
const precheckReauth: X402Precheck<ReauthBody> = async ({ body, principal }) => {
  if (!hasConnectionTokenSecret()) {
    console.error("[precheckReauth] X402_HMAC_SECRET not set; refusing to charge.");
    return {
      ok: false,
      httpStatus: 500,
      errorKind: "server_misconfiguration",
      message: "Connection tokens are not configured on the server.",
    };
  }

  const target = await loadReauthTarget(body.social_account_id, principal.principalId);
  if (!target.ok) return target;

  const oauthProbe = buildOAuthUrl({
    platform: target.platform,
    state: generateOAuthState(),
    redirectUri: target.redirectUri,
  });
  if (!oauthProbe.ok) {
    return { ok: false, httpStatus: 500, errorKind: "oauth_url_build_failed", message: oauthProbe.message };
  }
  return { ok: true };
};

export const POST = x402PaidEndpoint<ReauthBody, ReauthResult>({
  endpointPath: "/api/x402/reauth",
  rateLimitScope: "x402:reauth",
  rateLimitPerMinute: 10,
  defaultAction: "connect_account",

  parseBody: async (req: NextRequest) => {
    try {
      const json = await req.json();
      const parsed = ReauthBodySchema.safeParse(json);
      if (!parsed.success) {
        return {
          success: false,
          httpStatus: 400,
          errorKind: "validation_error",
          message: parsed.error.issues.map((issue) => issue.message).join("; "),
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

  precheck: precheckReauth,

  handler: async ({ body, principal, chargeId }) => {
    const target = await loadReauthTarget(body.social_account_id, principal.principalId);
    if (!target.ok) {
      return { success: false, errorKind: target.errorKind, message: target.message, refundable: true };
    }

    const connectionId = randomUUID();
    const oauthState = generateOAuthState();
    const expiresAt = new Date(Date.now() + OAUTH_EXPIRY_MINUTES * 60 * 1000).toISOString();

    const oauthResult = buildOAuthUrl({
      platform: target.platform,
      state: oauthState,
      redirectUri: target.redirectUri,
    });
    if (!oauthResult.ok) {
      return {
        success: false,
        errorKind: "oauth_url_build_failed",
        message: oauthResult.message,
        refundable: true,
      };
    }

    // The PKCE verifier (X) is written with the row, so no callback can
    // arrive before it exists.
    const { error: insertError } = await runQuery(
      db.insert(social_connections).values({
        id: connectionId,
        principal_id: principal.principalId,
        initiated_via: "x402",
        initiated_x402_charge_id: chargeId,
        platform: target.platform,
        oauth_state: oauthState,
        oauth_code_verifier: oauthResult.codeVerifier,
        redirect_uri: target.redirectUri,
        status: "pending",
        expires_at: expiresAt,
      }),
    );

    if (insertError) {
      return {
        success: false,
        errorKind: "db_insert_failed",
        message: "Failed to create re-auth connection record.",
        refundable: true,
      };
    }
    await updateChargeRecord(chargeId, { socialConnectionId: connectionId });

    const tokenResult = issueConnectionToken({
      connectionId,
      walletAddress: principal.address,
      chargeId,
      iat: Date.now(),
      exp: new Date(expiresAt).getTime() + CONNECTION_TOKEN_GRACE_MS,
      platform: target.platform,
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
        platform: target.platform,
        oauthUrl: oauthResult.url,
        connectionToken: tokenResult.token,
        expiresAt,
      },
    };
  },
});
