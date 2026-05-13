import "server-only";

import { verifyClerkToken } from "@clerk/mcp-tools/next";
import { auth } from "@clerk/nextjs/server";

import { checkOAuthClientTrust } from "../oauthClientTrust";

export type ResolveHints = {
  clientName?: string | null;
  clientVersion?: string | null;
};

/**
 * Result of a successful OAuth token verification. Carries the data
 * needed to build an McpPrincipal stub for the subscription gate, but
 * does NOT trigger any DB writes (no trust-check INSERT into
 * mcp_oauth_clients). That second step is gated on the principal
 * holding an active subscription, so we run it later from the
 * dispatcher.
 */
export type VerifiedOAuthToken = {
  principalId: string;
  oauthClientId: string;
  scopes: string[];
};

/**
 * Verifies a Clerk OAuth bearer token and returns the principal + client
 * identifiers. Pure read: no DB writes happen here.
 *
 * Returns null when:
 *   - The Clerk verify call fails
 *   - The verified token is missing `sub` (userId) or `clientId`
 *
 * Called by: src/lib/mcp/auth/resolve.ts (OAuth branch of the dispatcher)
 *
 * Source: extracted from src/lib/mcp/auth.ts:78-106 (originally part of
 *   the older monolithic resolveOAuth).
 */
export async function verifyOAuthToken(
  bearerToken: string,
): Promise<VerifiedOAuthToken | null> {
  try {
    const clerkAuth = await auth({ acceptsToken: "oauth_token" });
    const authInfo = verifyClerkToken(clerkAuth, bearerToken);

    if (!authInfo) {
      console.log("[verifyOAuthToken] Clerk token verification failed");
      return null;
    }

    const principalId = (authInfo.extra?.userId as string) ?? "";
    const oauthClientId = authInfo.clientId ?? "";

    if (!principalId || !oauthClientId) {
      console.log(
        "[verifyOAuthToken] Verified token missing userId or clientId",
      );
      return null;
    }

    return {
      principalId,
      oauthClientId,
      scopes: authInfo.scopes ?? [],
    };
  } catch (err) {
    console.error(
      "[verifyOAuthToken] Unexpected error:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Runs the OAuth client trust check for an already-verified principal.
 * This is the side-effectful step: on first sight of an oauthClientId,
 * the underlying `checkOAuthClientTrust` INSERTs a row into
 * mcp_oauth_clients (after its own rate-limit guard).
 *
 * Must be called AFTER the subscription gate has accepted the principal,
 * so that we never seed mcp_oauth_clients rows for non-paying users.
 *
 * Returns false when:
 *   - The client_id is explicitly revoked
 *   - The client_id is trust_level='blocked'
 *   - The first-sight INSERT was refused by the DCR rate limiter
 *
 * Called by: src/lib/mcp/auth/resolve.ts after applySubscriptionGate
 *   accepts an OAuth-kind principal.
 */
export async function assertOAuthClientTrust(
  oauthClientId: string,
  principalId: string,
  hints: ResolveHints,
): Promise<boolean> {
  const trust = await checkOAuthClientTrust(oauthClientId, principalId, {
    clientName: hints.clientName ?? null,
    softwareId: null,
    softwareVersion: null,
  });

  if (!trust.allowed) {
    console.log(
      `[assertOAuthClientTrust] Trust check refused client ${oauthClientId}: ${trust.reason}`,
    );
    return false;
  }

  return true;
}
