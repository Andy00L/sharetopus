import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { initiateWebOAuth } from "@/lib/api/oauth/web/initiateWebOAuth";
import { resolveConfiguredProvider } from "@/lib/platforms/providers/registry";
import { isRegistryOAuthPlatform } from "@/lib/platforms/providers/registryOAuthPlatforms";

/**
 * OAuth initiate for registry providers (Reddit, Threads, Tumblr, Twitch,
 * Kick, and any future one). One dynamic route replaces a folder per
 * platform: the provider's own buildAuthorizeUrl supplies the URL, and
 * initiateWebOAuth supplies the Clerk auth, subscription gate, account
 * limit gate, CSRF state cookie, and PKCE verifier cookie.
 *
 * The redirect lands on /api/social/registry/[provider]/callback.
 */
export async function POST(
  request: NextRequest,
  routeContext: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider: providerId } = await routeContext.params;

  if (!isRegistryOAuthPlatform(providerId)) {
    return NextResponse.json(
      { success: false, message: `Unknown provider "${providerId}".` },
      { status: 404 },
    );
  }

  const providerResult = resolveConfiguredProvider(providerId);
  if (!providerResult.ok || !providerResult.provider.buildAuthorizeUrl) {
    return NextResponse.json(
      {
        success: false,
        message: providerResult.ok
          ? `${providerResult.provider.label} does not use OAuth.`
          : providerResult.message,
      },
      { status: providerResult.ok ? 400 : 503 },
    );
  }
  const provider = providerResult.provider;

  const redirectUri = `${new URL(request.url).origin}/api/social/registry/${providerId}/callback`;

  return initiateWebOAuth({
    platform: providerId,
    stateCookieName: `${providerId}_auth_state`,
    // Only PKCE providers get a verifier cookie; setting one for the rest
    // would send an unused secret to the browser.
    verifierCookieName:
      provider.authKind === "oauth2_pkce"
        ? `${providerId}_auth_verifier`
        : undefined,
    buildAuthorizeUrl: (state, codeChallenge) => {
      const built = provider.buildAuthorizeUrl?.({
        state,
        redirectUri,
        codeChallenge,
      });
      if (!built) {
        return { ok: false, message: "Provider cannot build an OAuth URL." };
      }
      return built;
    },
  });
}
