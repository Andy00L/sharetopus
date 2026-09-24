import "server-only";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import {
  buildSocialAccountValues,
  connectPlatformAccounts,
} from "@/lib/api/oauth/connectPlatformAccounts";
import { escapeHtml, toJsString } from "@/lib/api/oauth/escapeHtml";
import type { PostingPlatform } from "@/lib/platforms/capabilities";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export interface WebOAuthCallbackConfig {
  platform: PostingPlatform;
  /** Must match the initiate route's cookie names. */
  stateCookieName: string;
  verifierCookieName?: string;
  /** window.opener callback the popup invokes, e.g. "onYouTubeConnectSuccess". */
  successCallbackName: string;
  failureCallbackName: string;
  /**
   * The redirect URI the initiate route put in the authorize URL (its env
   * var); the token exchange must send the same value.
   */
  redirectUri: string | undefined;
}

/**
 * Shared body of every /api/social/<platform>/connect callback route:
 * Clerk auth, provider-error handling, CSRF state verification, PKCE
 * verifier retrieval, the code exchange and profile read
 * (connectPlatformAccounts), the social_accounts upsert (one row per
 * returned account), and the popup HTML that notifies the opener window.
 *
 * Called by: /api/social/{linkedin,tiktok,pinterest,instagram,youtube,x,facebook}/connect
 */
export async function completeWebOAuthConnect(
  request: NextRequest,
  config: WebOAuthCallbackConfig,
): Promise<NextResponse> {
  const logPrefix = `[completeWebOAuthConnect ${config.platform}]`;

  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized - authentication required" },
        { status: 401 },
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const providerError = searchParams.get("error");
    const providerErrorDescription = searchParams.get("error_description");

    if (providerError) {
      console.error(
        `${logPrefix} Provider error: ${providerError} - ${providerErrorDescription}`,
      );
      return buildPopupResponse(config, {
        ok: false,
        title: "Connection Failed",
        bodyText: `${config.platform} connection failed. This window will close automatically.`,
        errorMessage: providerErrorDescription ?? providerError,
        status: 400,
      });
    }

    const cookieStore = await cookies();
    const storedState = cookieStore.get(config.stateCookieName)?.value;

    if (!state || !storedState || state !== storedState) {
      return buildPopupResponse(config, {
        ok: false,
        title: "Security Verification Failed",
        bodyText:
          "The security verification has failed. This window will close automatically.",
        errorMessage: "Security verification failed",
        status: 400,
      });
    }

    // Clear both cookies immediately after verification; the PKCE verifier
    // is single use by definition.
    cookieStore.delete(config.stateCookieName);
    let codeVerifier: string | null = null;
    if (config.verifierCookieName) {
      codeVerifier = cookieStore.get(config.verifierCookieName)?.value ?? null;
      cookieStore.delete(config.verifierCookieName);
      if (!codeVerifier) {
        return buildPopupResponse(config, {
          ok: false,
          title: "Missing Verifier",
          bodyText:
            "The PKCE verifier is missing. This window will close automatically.",
          errorMessage: "Missing PKCE verifier",
          status: 400,
        });
      }
    }

    if (!code) {
      return buildPopupResponse(config, {
        ok: false,
        title: "Missing Parameters",
        bodyText:
          "Necessary parameters are missing. This window will close automatically.",
        errorMessage: "Missing code or state",
        status: 400,
      });
    }

    if (!config.redirectUri) {
      console.error(`${logPrefix} Redirect URI is not configured.`);
      return buildPopupResponse(config, {
        ok: false,
        title: "Configuration Error",
        bodyText:
          "This connection is not configured. This window will close automatically.",
        errorMessage: `${config.platform} redirect URI is not configured`,
        status: 500,
      });
    }

    const exchangeResult = await connectPlatformAccounts(config.platform, {
      code,
      redirectUri: config.redirectUri,
      codeVerifier,
    });
    if (!exchangeResult.success) {
      console.error(`${logPrefix} Exchange failed: ${exchangeResult.message}`);
      return buildPopupResponse(config, {
        ok: false,
        title: "Token Exchange Failed",
        bodyText:
          "Failed to exchange the authorization code. This window will close automatically.",
        errorMessage: exchangeResult.message,
        status: 400,
      });
    }

    if (exchangeResult.accounts.length === 0) {
      return buildPopupResponse(config, {
        ok: false,
        title: "No Account Found",
        bodyText:
          "No connectable account was found. This window will close automatically.",
        errorMessage: `No ${config.platform} account found to connect`,
        status: 400,
      });
    }

    // Upsert one social_accounts row per returned account. The unique key
    // (principal_id, platform, account_identifier) makes reconnects update
    // in place, mirroring handleOAuthCallback in the x402 flow.
    for (const connectedAccount of exchangeResult.accounts) {
      const accountValues = buildSocialAccountValues(
        userId,
        config.platform,
        connectedAccount,
      );

      const { error: upsertError } = await runQuery(
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
          }),
      );

      if (upsertError) {
        console.error(
          `${logPrefix} social_accounts upsert failed for ${connectedAccount.accountIdentifier}: ${upsertError.message}`,
        );
        return buildPopupResponse(config, {
          ok: false,
          title: "Database Error",
          bodyText:
            "Error while saving the account. This window will close automatically.",
          errorMessage: "Database error",
          status: 500,
        });
      }
    }

    console.log(
      `${logPrefix} Connected ${exchangeResult.accounts.length} account(s) for user ${userId}`,
    );

    return buildPopupResponse(config, {
      ok: true,
      title: "Connection Successful",
      bodyText: `${config.platform} account successfully connected. This window will close automatically.`,
      status: 200,
    });
  } catch (error) {
    console.error(`${logPrefix} Unexpected error:`, error);
    return buildPopupResponse(config, {
      ok: false,
      title: "Unexpected Error",
      bodyText:
        "An unexpected error occurred. This window will close automatically.",
      errorMessage: "An unexpected error occurred",
      status: 500,
    });
  }
}

// ---------------------------------------------------------------------------
// Popup HTML
// ---------------------------------------------------------------------------

/**
 * The popup result page invokes the opener callback by name and closes
 * itself, matching the contract of the platform Connect buttons.
 */
function buildPopupResponse(
  config: WebOAuthCallbackConfig,
  page: {
    ok: boolean;
    title: string;
    bodyText: string;
    errorMessage?: string;
    status: number;
  },
): NextResponse {
  const callbackName = page.ok
    ? config.successCallbackName
    : config.failureCallbackName;
  const callbackArgs = page.ok ? "" : toJsString(page.errorMessage ?? "");

  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>${escapeHtml(page.title)}</title>
    <script>
      if (window.opener && typeof window.opener[${toJsString(callbackName)}] === "function") {
        window.opener[${toJsString(callbackName)}](${callbackArgs});
        window.close();
      }
    </script>
  </head>
  <body>
    <p>${escapeHtml(page.bodyText)}</p>
  </body>
</html>`;

  return new NextResponse(html, {
    status: page.status,
    headers: { "Content-Type": "text/html" },
  });
}
