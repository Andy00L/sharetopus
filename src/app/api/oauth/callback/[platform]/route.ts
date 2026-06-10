import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { extractIpHash, extractUserAgent } from "@/lib/api/context";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { escapeHtml } from "@/lib/api/oauth/escapeHtml";
import { logX402Call } from "@/lib/x402/audit/logX402Call";
import { handleOAuthCallback } from "@/lib/x402/oauth/callback/handleOAuthCallback";
import type { OAuthCallbackResult } from "@/lib/x402/oauth/callback/handleOAuthCallback";
import { isX402Platform, getAppUrl } from "@/lib/x402/config";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/oauth/callback/linkedin?code=...&state=...
 * GET /api/oauth/callback/tiktok?code=...&state=...
 * etc.
 *
 * Shared OAuth callback for x402-originated and REST-originated
 * connections. No Clerk session required. State param validation
 * via social_connections row lookup is the only auth.
 *
 * Rate limit: 60/min per IP (x402_oauth_callback scope). The endpoint is
 * unauthenticated and triggers DB lookups plus outbound provider calls, so
 * it must not be free to hammer.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> }
): Promise<NextResponse> {
  const startMs = performance.now();
  const ipHash = await extractIpHash();
  const userAgent = await extractUserAgent();
  const params = await context.params;

  const platformParam = params.platform;

  // Validate platform
  if (!isX402Platform(platformParam)) {
    return new NextResponse(
      buildHtmlPage(
        "Invalid Platform",
        `Platform "${platformParam}" is not supported.`
      ),
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  const platform = platformParam;

  // Rate limit before any DB or provider work.
  const rateLimitResult = await checkRateLimit(
    "x402_oauth_callback",
    null,
    60,
    60
  );
  if (!rateLimitResult.success) {
    return new NextResponse(
      buildHtmlPage(
        "Too Many Requests",
        "Too many callback attempts. Please try again shortly."
      ),
      {
        status: 429,
        headers: {
          "Content-Type": "text/html",
          "Retry-After": String(rateLimitResult.resetIn ?? 60),
        },
      }
    );
  }

  // Parse query params
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const errorCode = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (!state) {
    return new NextResponse(
      buildHtmlPage(
        "Missing State",
        "OAuth state parameter is missing."
      ),
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  // A hit with neither a code nor a provider error is not a real callback;
  // rejecting it here keeps a stray request from burning the pending
  // connection with a doomed token exchange.
  if (!code && !errorCode) {
    return new NextResponse(
      buildHtmlPage(
        "Missing Code",
        "OAuth code parameter is missing."
      ),
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  // Process callback via shared handler (looks up social_connections by state)
  const result = await handleOAuthCallback({
    platform,
    code,
    state,
    errorCode,
    errorDescription,
  });

  const appUrl = getAppUrl();

  if (!result.ok) {
    const errorMessage =
      result.error.kind === "provider_error"
        ? `OAuth provider error: ${result.error.message}`
        : result.error.message;

    await logX402Call({
      principal: null,
      action: "connect_account",
      endpoint: `/api/oauth/callback/${platform}`,
      chargeId: null,
      resultStatus: "error",
      latencyMs: Math.round(performance.now() - startMs),
      ipHash,
      userAgent,
    });

    // Share-link flows redirect to the share error page instead of inline HTML
    if (result.error.kind.startsWith("share_link_") || result.error.kind === "owner_account_limit_reached") {
      return NextResponse.redirect(
        `${appUrl}/share/${platform}/error?reason=${encodeURIComponent(result.error.kind)}`,
      );
    }

    return new NextResponse(
      buildHtmlPage("Connection Failed", errorMessage),
      {
        status: mapCallbackErrorToHttpStatus(result.error.kind),
        headers: { "Content-Type": "text/html" },
      }
    );
  }

  await logX402Call({
    principal: null,
    action: "connect_account",
    endpoint: `/api/oauth/callback/${platform}`,
    chargeId: null,
    resultStatus: "ok",
    latencyMs: Math.round(performance.now() - startMs),
    ipHash,
    userAgent,
  });

  // Share-link flows redirect to the share success page
  if (result.shareLinkId) {
    const maskedAccount = result.accountUsername
      ? encodeURIComponent(result.accountUsername)
      : "";
    return NextResponse.redirect(
      `${appUrl}/share/${platform}/success${maskedAccount ? `?account=${maskedAccount}` : ""}`,
    );
  }

  return new NextResponse(
    buildHtmlPage(
      "Connection Successful",
      `Your ${platform} account has been connected successfully. You can close this window.`
    ),
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}

// ---------------------------------------------------------------------------
// Error status mapping
// ---------------------------------------------------------------------------

type CallbackErrorKind = Extract<
  OAuthCallbackResult,
  { ok: false }
>["error"]["kind"];

/**
 * Failure pages carry non-2xx statuses so agents and monitoring can tell a
 * failed callback from a successful one without parsing HTML.
 */
function mapCallbackErrorToHttpStatus(kind: CallbackErrorKind): number {
  switch (kind) {
    case "state_not_found":
    case "state_expired":
    case "state_already_used":
    case "provider_error":
      return 400;
    case "token_exchange_failed":
      return 502;
    case "db_update_failed":
      return 500;
    // Share-link kinds redirect before reaching here; this keeps the switch
    // total if that ever changes.
    case "share_link_not_found":
    case "share_link_revoked":
    case "share_link_expired":
    case "share_link_max_uses_reached":
    case "owner_account_limit_reached":
      return 400;
  }
}

// ---------------------------------------------------------------------------
// HTML page builder
// ---------------------------------------------------------------------------

function buildHtmlPage(title: string, message: string): string {
  // Escape HTML entities to prevent XSS
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>${safeTitle}</title>
    <style>
      body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f9fafb; }
      .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); max-width: 400px; text-align: center; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #6b7280; margin: 0; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${safeTitle}</h1>
      <p>${safeMessage}</p>
    </div>
  </body>
</html>`;
}
