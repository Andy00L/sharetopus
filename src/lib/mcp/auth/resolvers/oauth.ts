import "server-only";

import { verifyClerkToken } from "@clerk/mcp-tools/next";
import { auth } from "@clerk/nextjs/server";

import { checkOAuthClientTrust } from "../oauthClientTrust";

export type ResolveHints = {
  clientName?: string | null;
};

export type VerifiedOAuthToken = {
  principalId: string;
  oauthClientId: string;
  scopes: string[];
};

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

    const userIdClaim = authInfo.extra?.userId;
    const principalId = typeof userIdClaim === "string" ? userIdClaim : "";
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

export async function assertOAuthClientTrust(
  oauthClientId: string,
  principalId: string,
  hints: ResolveHints,
): Promise<"allowed" | "refused" | "unavailable"> {
  const trust = await checkOAuthClientTrust(oauthClientId, principalId, {
    clientName: hints.clientName ?? null,
    softwareId: null,
    softwareVersion: null,
  });

  if (trust.allowed) return "allowed";

  console.log(
    `[assertOAuthClientTrust] Trust check refused client ${oauthClientId}: ${trust.reason}`,
  );
  return trust.reason === "lookup_failed" ? "unavailable" : "refused";
}
