import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { checkAccountLimits } from "@/actions/server/connections/checkAccountLimits";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { validateShareToken } from "@/actions/server/share-link/validateShareToken";
import { extractIpHash, extractUserAgent } from "@/lib/api/context";
import { buildOAuthUrl } from "@/lib/x402/connect/buildOAuthUrl";
import { logX402Call } from "@/lib/x402/audit/logX402Call";
import { generateOAuthState } from "@/lib/x402/oauth/state";

export const runtime = "nodejs";
export const maxDuration = 30;

const OAUTH_EXPIRY_MINUTES = 15;

/**
 * POST /share/[platform]/[token]/initiate
 *
 * Triggered by the "Connect TikTok Account" button on the share landing page.
 * Creates a social_connections row with initiated_via='share_link', then
 * redirects the friend to TikTok's OAuth authorization page.
 *
 * No auth required. Rate limited to 5/min per IP to block bot abuse.
 * The friend does not need a Sharetopus account.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ platform: string; token: string }> },
): Promise<NextResponse> {
  const startMs = performance.now();
  const { platform, token } = await context.params;
  const ipHash = await extractIpHash();
  const userAgent = await extractUserAgent();

  // MVP: only TikTok
  if (platform !== "tiktok") {
    return redirectToError(platform, "unsupported_platform");
  }

  // 1. Rate limit: 5/min per IP (userId=null falls back to IP)
  const rateLimitResult = await checkRateLimit(
    "shareLink.use",
    null,
    5,
    60,
  );
  if (!rateLimitResult.success) {
    return redirectToError(platform, "rate_limited");
  }

  // 2. Re-validate the token
  const validation = await validateShareToken(token);
  if (!validation.success) {
    return redirectToError(platform, validation.reason);
  }
  const shareLink = validation.data;

  // 3. Re-validate creator account limit (defense against changes since landing)
  const subscription = await checkActiveSubscription(
    shareLink.owner_principal_id,
  );
  const limitsCheck = await checkAccountLimits(
    shareLink.owner_principal_id,
    subscription.tier,
  );
  if (!limitsCheck.success || !limitsCheck.canAddMore) {
    return redirectToError(platform, "owner_account_limit_reached");
  }

  // 4. Generate OAuth state
  const oauthState = generateOAuthState();

  // 5. Build the TikTok auth URL via shared builder
  const redirectUri = process.env.X402_TIKTOK_REDIRECT_URI;
  if (!redirectUri) {
    console.error("[share/initiate] X402_TIKTOK_REDIRECT_URI not set.");
    return redirectToError(platform, "configuration_error");
  }

  const oauthUrlResult = buildOAuthUrl({
    platform: "tiktok",
    state: oauthState,
    redirectUri,
  });
  if (!oauthUrlResult.ok) {
    console.error(
      `[share/initiate] buildOAuthUrl failed: ${oauthUrlResult.message}`,
    );
    return redirectToError(platform, "configuration_error");
  }

  // 6. Insert social_connections row
  const connectionId = randomUUID();
  const expiresAt = new Date(
    Date.now() + OAUTH_EXPIRY_MINUTES * 60 * 1000,
  ).toISOString();

  const { error: insertError } = await adminSupabase
    .from("social_connections")
    .insert({
      id: connectionId,
      principal_id: shareLink.owner_principal_id,
      platform: "tiktok",
      oauth_state: oauthState,
      initiated_via: "share_link",
      share_link_id: shareLink.id,
      redirect_uri: redirectUri,
      status: "pending",
      expires_at: expiresAt,
      metadata: {
        source: "share_link",
        share_link_id: shareLink.id,
        friend_ip_hash: ipHash,
        friend_user_agent: userAgent,
      },
    });

  if (insertError) {
    // Handle oauth_state unique constraint collision: retry once with new state
    if (insertError.code === "23505") {
      const retryState = generateOAuthState();
      const retryOauthUrl = buildOAuthUrl({
        platform: "tiktok",
        state: retryState,
        redirectUri,
      });
      if (!retryOauthUrl.ok) {
        return redirectToError(platform, "configuration_error");
      }

      const { error: retryError } = await adminSupabase
        .from("social_connections")
        .insert({
          id: randomUUID(),
          principal_id: shareLink.owner_principal_id,
          platform: "tiktok",
          oauth_state: retryState,
          initiated_via: "share_link",
          share_link_id: shareLink.id,
          redirect_uri: redirectUri,
          status: "pending",
          expires_at: expiresAt,
          metadata: {
            source: "share_link",
            share_link_id: shareLink.id,
            friend_ip_hash: ipHash,
            friend_user_agent: userAgent,
          },
        });

      if (retryError) {
        console.error(
          `[share/initiate] social_connections insert retry failed: ${retryError.message}`,
        );
        return redirectToError(platform, "internal_error");
      }

      // 7. Audit log
      logX402Call({
        principal: null,
        action: "share_link.use_initiated",
        endpoint: `/share/${platform}/${token}/initiate`,
        chargeId: null,
        resultStatus: "ok",
        latencyMs: Math.round(performance.now() - startMs),
        ipHash,
        userAgent,
      });

      return NextResponse.redirect(retryOauthUrl.url, 302);
    }

    console.error(
      `[share/initiate] social_connections insert failed: ${insertError.message}`,
    );
    return redirectToError(platform, "internal_error");
  }

  // 7. Audit log
  logX402Call({
    principal: null,
    action: "share_link.use_initiated",
    endpoint: `/share/${platform}/${token}/initiate`,
    chargeId: null,
    resultStatus: "ok",
    latencyMs: Math.round(performance.now() - startMs),
    ipHash,
    userAgent,
  });

  // 8. Redirect to TikTok OAuth
  return NextResponse.redirect(oauthUrlResult.url, 302);
}

/** Redirects to the share error page with a reason query param */
function redirectToError(platform: string, reason: string): NextResponse {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    "https://sharetopus.com";
  return NextResponse.redirect(
    `${baseUrl}/share/${platform}/error?reason=${encodeURIComponent(reason)}`,
    302,
  );
}
