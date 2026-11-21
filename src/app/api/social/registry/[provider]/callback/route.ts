import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import { resolveConfiguredProvider } from "@/lib/platforms/providers/registry";
import { isRegistryOAuthPlatform } from "@/lib/platforms/providers/catalog";
import type { ProviderConnectResult } from "@/lib/platforms/providers/types";

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
  if (provider.authKind === "credentials") {
    return clearOAuthCookies(redirectToConnections("error", "unknown_provider"));
  }

  const redirectUri = `${requestUrl.origin}/api/social/registry/${providerId}/callback`;
  let connectResult: ProviderConnectResult;
  if (provider.authKind === "oauth2_pkce") {
    const codeVerifier = cookieStore.get(verifierCookieName)?.value;
    if (!codeVerifier) {
      return clearOAuthCookies(redirectToConnections("error", "missing_verifier"));
    }
    connectResult = await provider.connect({ code: codeParam, redirectUri, codeVerifier });
  } else {
    connectResult = await provider.connect({ code: codeParam, redirectUri });
  }

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

  const accountValues = {
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
    extra: connectResult.config,
    updated_at: new Date().toISOString(),
  } satisfies typeof social_accounts.$inferInsert;

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
      `[registry/callback ${providerId}] Upsert failed for user ${userId}: ${upsertError.message}`,
    );
    return clearOAuthCookies(redirectToConnections("error", "save_failed"));
  }

  return clearOAuthCookies(redirectToConnections("success", providerId));
}
