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
import { buildOAuthUrl } from "@/lib/x402/connect/buildOAuthUrl";
import type { Platform } from "@/lib/x402/connect/types";
import { generateOAuthState } from "@/lib/x402/oauth/state";
import {
  issueConnectionToken,
  loadConnectionTokenSecret,
} from "@/lib/x402/oauth/connectionToken";
import {
  CONNECTION_TOKEN_GRACE_MS,
  OAUTH_EXPIRY_MINUTES,
  getOAuthRedirectUri,
  isX402Platform,
} from "@/lib/x402/config";

export const runtime = "nodejs";
export const maxDuration = 60;

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

const precheckReauth: X402Precheck<ReauthBody> = async ({ body, principal }) => {
  if (!loadConnectionTokenSecret().ok) {
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
    const tokenSecretResult = loadConnectionTokenSecret();
    if (!tokenSecretResult.ok) {
      return { success: false, errorKind: "token_issue_failed", message: "Failed to issue the connection token." };
    }

    const target = await loadReauthTarget(body.social_account_id, principal.principalId);
    if (!target.ok) {
      return { success: false, errorKind: target.errorKind, message: target.message };
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
      };
    }

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
      };
    }

    return {
      success: true,
      data: {
        connectionId,
        platform: target.platform,
        oauthUrl: oauthResult.url,
        connectionToken: issueConnectionToken(tokenSecretResult.secret, {
          connectionId,
          walletAddress: principal.address,
          chargeId,
          iat: Date.now(),
          exp: new Date(expiresAt).getTime() + CONNECTION_TOKEN_GRACE_MS,
          platform: target.platform,
        }),
        expiresAt,
      },
      chargeRecord: { socialConnectionId: connectionId },
    };
  },
});
