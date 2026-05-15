import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { extractIpHash, extractUserAgent } from "@/lib/api/context";
import { escapeHtml } from "@/lib/api/oauth/escapeHtml";
import { logX402Call } from "@/lib/x402/audit/logX402Call";
import { handleOAuthCallback } from "@/lib/x402/oauth/callback/handleOAuthCallback";
import type { Platform } from "@/lib/x402/connect/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_PLATFORMS = new Set<Platform>([
  "linkedin",
  "tiktok",
  "pinterest",
  "instagram",
]);

/**
 * GET /api/oauth/callback/linkedin?code=...&state=...
 * GET /api/oauth/callback/tiktok?code=...&state=...
 * etc.
 *
 * Shared OAuth callback for x402-originated and REST-originated
 * connections. No Clerk session required. State param validation
 * via social_connections row lookup is the only auth.
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
  if (!VALID_PLATFORMS.has(platformParam as Platform)) {
    return new NextResponse(
      buildHtmlPage(
        "Invalid Platform",
        `Platform "${platformParam}" is not supported.`
      ),
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  const platform = platformParam as Platform;

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

  // Process callback via shared handler (looks up social_connections by state)
  const result = await handleOAuthCallback({
    platform,
    code,
    state,
    errorCode,
    errorDescription,
  });

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

    return new NextResponse(
      buildHtmlPage("Connection Failed", errorMessage),
      { status: 200, headers: { "Content-Type": "text/html" } }
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

  // If a redirect URL was provided, redirect there
  if (result.redirectUrl) {
    return NextResponse.redirect(result.redirectUrl);
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

