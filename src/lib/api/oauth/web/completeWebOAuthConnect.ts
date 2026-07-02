import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { escapeHtml, toJsString } from "@/lib/api/oauth/escapeHtml";
import type { Json, Platform } from "@/lib/types/database.types";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/** One connected account normalized for the social_accounts upsert. */
export interface NormalizedConnectedAccount {
  accountIdentifier: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  emailAddress: string | null;
  accessToken: string;
  refreshToken: string | null;
  /** ISO expiry; null means the token never expires (Facebook Page tokens). */
  tokenExpiresAt: string | null;
  extra: Json;
}

export type ExchangeAndFetchAccountsResult =
  | { success: true; accounts: NormalizedConnectedAccount[] }
  | { success: false; message: string };

export interface WebOAuthCallbackConfig {
  platform: Platform;
  /** Must match the initiate route's cookie names. */
  stateCookieName: string;
  verifierCookieName?: string;
  /** window.opener callback the popup invokes, e.g. "onYouTubeConnectSuccess". */
  successCallbackName: string;
  failureCallbackName: string;
  /**
   * Exchanges the code and returns every account to store. Facebook returns
   * one entry per managed Page; other platforms return exactly one.
   * codeVerifier is non-null only when verifierCookieName is set (PKCE).
   */
  exchangeAndFetchAccounts: (
    code: string,
    codeVerifier: string | null,
  ) => Promise<ExchangeAndFetchAccountsResult>;
}

/**
 * Shared body of every /api/social/<platform>/connect callback route:
 * Clerk auth, provider-error handling, CSRF state verification, PKCE
 * verifier retrieval, token exchange, social_accounts upsert (one row per
 * returned account), and the popup HTML that notifies the opener window.
 *
 * Extracted for the youtube/x/facebook routes; the four older platform
 * connect routes predate it and still inline the same steps.
 *
 * Called by: /api/social/{youtube,x,facebook}/connect
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

    const exchangeResult = await config.exchangeAndFetchAccounts(
      code,
      codeVerifier,
    );
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
      const { error: upsertError } = await adminSupabase
        .from("social_accounts")
        .upsert(
          {
            principal_id: userId,
            platform: config.platform,
            account_identifier: connectedAccount.accountIdentifier,
            is_available: true,
            display_name: connectedAccount.displayName,
            username: connectedAccount.username,
            avatar_url: connectedAccount.avatarUrl,
            email_address: connectedAccount.emailAddress,
            access_token: connectedAccount.accessToken,
            refresh_token: connectedAccount.refreshToken,
            token_expires_at: connectedAccount.tokenExpiresAt,
            extra: connectedAccount.extra,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "principal_id, platform, account_identifier" },
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
