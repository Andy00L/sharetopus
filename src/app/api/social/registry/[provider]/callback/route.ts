import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { resolveConfiguredProvider } from "@/lib/platforms/providers/registry";
import { providerConfigToJson } from "@/lib/platforms/providers/_shared/configJson";
import { isRegistryOAuthPlatform } from "@/lib/platforms/providers/registryOAuthPlatforms";

/**
 * OAuth callback for registry providers. Pairs with
 * /api/social/registry/[provider]/initiate, which set the state cookie
 * (and, for PKCE providers, the verifier cookie) on this browser.
 *
 * Flow: verify the state param against the HTTP-only cookie in constant
 * time, exchange the code through the provider, upsert social_accounts,
 * then redirect to the connections page. The cookies are cleared on every
 * exit path, success or failure, so a state can never be replayed.
 *
 * The signed-in Clerk user is the owner. The cookie check binds the
 * callback to the same browser that initiated, which is the CSRF defense:
 * an attacker-supplied code cannot be planted on a victim's account
 * without also holding the victim's state cookie.
 */
export async function GET(
  request: NextRequest,
  routeContext: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider: providerId } = await routeContext.params;
  const requestUrl = new URL(request.url);

  const redirectToConnections = (outcome: "success" | "error", detail: string) =>
    NextResponse.redirect(
      `${requestUrl.origin}/connections?connect=${outcome}&detail=${encodeURIComponent(detail)}`,
      302,
    );

  if (!isRegistryOAuthPlatform(providerId)) {
    return redirectToConnections("error", "unknown_provider");
  }

  const stateCookieName = `${providerId}_auth_state`;
  const verifierCookieName = `${providerId}_auth_verifier`;
  const cookieStore = await cookies();

  // Clear both cookies no matter how this request ends: one-shot state.
  const clearOAuthCookies = (response: NextResponse) => {
    response.cookies.delete(stateCookieName);
    response.cookies.delete(verifierCookieName);
    return response;
  };

  const { userId } = await auth();
  if (!userId) {
    return clearOAuthCookies(redirectToConnections("error", "signed_out"));
  }

  const providerError = requestUrl.searchParams.get("error");
  if (providerError) {
    // The user declined consent (or the provider failed). Nothing to store.
    return clearOAuthCookies(redirectToConnections("error", providerError));
  }

  const stateParam = requestUrl.searchParams.get("state") ?? "";
  const codeParam = requestUrl.searchParams.get("code") ?? "";
  const stateCookie = cookieStore.get(stateCookieName)?.value ?? "";

  const stateParamBuf = Buffer.from(stateParam, "utf-8");
  const stateCookieBuf = Buffer.from(stateCookie, "utf-8");
  const stateMatches =
    stateParam.length > 0 &&
    stateParamBuf.length === stateCookieBuf.length &&
    timingSafeEqual(stateParamBuf, stateCookieBuf);

  if (!stateMatches || !codeParam) {
    console.warn(
      `[registry/callback ${providerId}] State mismatch or missing code for user ${userId}.`,
    );
    return clearOAuthCookies(redirectToConnections("error", "invalid_state"));
  }

  const providerResult = resolveConfiguredProvider(providerId);
  if (!providerResult.ok) {
    return clearOAuthCookies(redirectToConnections("error", "not_configured"));
  }
  const provider = providerResult.provider;

  const codeVerifier =
    provider.authKind === "oauth2_pkce"
      ? (cookieStore.get(verifierCookieName)?.value ?? null)
      : null;
  if (provider.authKind === "oauth2_pkce" && !codeVerifier) {
    return clearOAuthCookies(redirectToConnections("error", "missing_verifier"));
  }

  const connectResult = await provider.connect({
    kind: "oauth_code",
    code: codeParam,
    redirectUri: `${requestUrl.origin}/api/social/registry/${providerId}/callback`,
    codeVerifier,
  });

  if (!connectResult.ok) {
    console.error(
      `[registry/callback ${providerId}] Exchange failed for user ${userId}: ${connectResult.message}`,
    );
    return clearOAuthCookies(redirectToConnections("error", "exchange_failed"));
  }

  const tokenExpiresAt =
    connectResult.expiresIn === null
      ? null
      : new Date(Date.now() + connectResult.expiresIn * 1000).toISOString();

  const { error: upsertError } = await adminSupabase
    .from("social_accounts")
    .upsert(
      {
        principal_id: userId,
        platform: providerId,
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
    );

  if (upsertError) {
    console.error(
      `[registry/callback ${providerId}] Upsert failed for user ${userId}: ${upsertError.message}`,
    );
    return clearOAuthCookies(redirectToConnections("error", "save_failed"));
  }

  return clearOAuthCookies(redirectToConnections("success", providerId));
}
