import "server-only";
import { auth } from "@clerk/nextjs/server";
import { verifyClerkToken } from "@clerk/mcp-tools/next";
import type { McpPrincipal } from "../types";
import { checkOAuthClientTrust } from "../oauthClientTrust";

export type ResolveHints = {
  clientName?: string | null;
  clientVersion?: string | null;
};

/**
 * Resolves a Clerk OAuth bearer token to a principal.
 *
 * Verifies via @clerk/mcp-tools/next.verifyClerkToken, extracts user ID
 * (sub claim) and OAuth client ID. Returns null on verification failure.
 *
 * The `hints` parameter carries MCP initialize handshake metadata used by
 * the trust check on first-sight INSERT (D2/D7).
 *
 * Source: extracted from src/lib/mcp/auth.ts:78-106.
 */
export async function resolveOAuth(
  bearerToken: string,
  hints: ResolveHints = {}
): Promise<McpPrincipal | null> {
  try {
    const clerkAuth = await auth({ acceptsToken: "oauth_token" });
    const authInfo = verifyClerkToken(clerkAuth, bearerToken);

    if (!authInfo) {
      console.log("[resolveOAuth] Token verification failed");
      return null;
    }

    const principalId = (authInfo.extra?.userId as string) ?? "";
    const oauthClientId = authInfo.clientId ?? "";

    if (!principalId || !oauthClientId) {
      console.log(
        "[resolveOAuth] Missing userId or clientId in verified token"
      );
      return null;
    }

    const trust = await checkOAuthClientTrust(oauthClientId, principalId, {
      clientName: hints.clientName ?? null,
      softwareId: null,
      softwareVersion: null,
    });

    if (!trust.allowed) {
      console.log(
        `[resolveOAuth] Trust check refused client ${oauthClientId}: ${trust.reason}`
      );
      return null;
    }

    return {
      kind: "oauth",
      principalId,
      oauthClientId,
      scopes: authInfo.scopes ?? [],
      plan: "free",
      priceId: null,
    };
  } catch (err) {
    console.error(
      "[resolveOAuth] Unexpected error:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
