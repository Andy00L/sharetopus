import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { initiateWebOAuth } from "@/lib/api/oauth/web/initiateWebOAuth";
import { resolveConfiguredProvider } from "@/lib/platforms/providers/registry";
import { isRegistryOAuthPlatform } from "@/lib/platforms/providers/catalog";

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
  if (!providerResult.ok) {
    return NextResponse.json(
      { success: false, message: providerResult.message },
      { status: 503 },
    );
  }
  const provider = providerResult.provider;
  if (provider.authKind === "credentials") {
    return NextResponse.json(
      { success: false, message: `${provider.label} does not use OAuth.` },
      { status: 400 },
    );
  }

  const redirectUri = `${new URL(request.url).origin}/api/social/registry/${providerId}/callback`;

  return initiateWebOAuth({
    platform: providerId,
    stateCookieName: `${providerId}_auth_state`,
    verifierCookieName:
      provider.authKind === "oauth2_pkce"
        ? `${providerId}_auth_verifier`
        : undefined,
    buildAuthorizeUrl: (state, codeChallenge) =>
      provider.buildAuthorizeUrl({ state, redirectUri, codeChallenge }),
  });
}
