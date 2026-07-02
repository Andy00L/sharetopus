import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { checkAccountLimits } from "@/actions/server/connections/checkAccountLimits";
import type { Platform } from "@/lib/types/database.types";
import { auth } from "@clerk/nextjs/server";
import { nanoid } from "nanoid";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/** State/verifier cookies live 15 minutes, the OAuth window. */
const OAUTH_COOKIE_MAX_AGE_SECONDS = 60 * 15;
/** 48 random bytes base64url-encode to 64 chars, inside the RFC 7636 43-128 range. */
const PKCE_VERIFIER_RANDOM_BYTES = 48;

export interface WebOAuthInitiateConfig {
  /** Platform key, used in logs only here. */
  platform: Platform;
  /** HTTP-only cookie holding the CSRF state, e.g. "youtube_auth_state". */
  stateCookieName: string;
  /** Set for PKCE platforms (X); holds the code_verifier between redirects. */
  verifierCookieName?: string;
  /**
   * Builds the provider authorize URL. codeChallenge is the S256 challenge
   * when verifierCookieName is set, null otherwise.
   */
  buildAuthorizeUrl: (
    state: string,
    codeChallenge: string | null,
  ) => { ok: true; url: string } | { ok: false; message: string };
}

/**
 * Shared body of every /api/social/<platform>/initiate route: Clerk auth,
 * subscription gate, account-limit gate, CSRF state cookie, optional PKCE
 * verifier cookie, then the provider authorize URL for the popup.
 *
 * Extracted for the youtube/x/facebook routes; the four older platform
 * initiate routes predate it and still inline the same steps.
 *
 * Called by: /api/social/{youtube,x,facebook}/initiate
 */
export async function initiateWebOAuth(
  config: WebOAuthInitiateConfig,
): Promise<NextResponse> {
  const logPrefix = `[initiateWebOAuth ${config.platform}]`;

  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, message: "Unauthorized - authentication required" },
        { status: 401 },
      );
    }

    const subscriptionCheck = await checkActiveSubscription(userId);
    if (!subscriptionCheck.isActive) {
      return NextResponse.json(
        { success: false, message: "Active subscription required" },
        { status: 403 },
      );
    }

    const limitsCheck = await checkAccountLimits(
      userId,
      subscriptionCheck.tier,
    );
    if (!limitsCheck.success) {
      return NextResponse.json(
        { success: false, message: "Unable to verify account limits" },
        { status: 500 },
      );
    }
    if (!limitsCheck.canAddMore) {
      console.warn(
        `${logPrefix} User ${userId} tried to connect past their account limit`,
      );
      return NextResponse.json(
        {
          success: false,
          message: `Account limit reached (${limitsCheck.currentCount}/${limitsCheck.maxAllowed})`,
        },
        { status: 403 },
      );
    }

    // CSRF state + optional PKCE verifier, both bound to the browser via
    // HTTP-only cookies that the connect callback verifies and clears.
    const state = nanoid(32);
    let codeChallenge: string | null = null;

    const cookieStore = await cookies();
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
      path: "/",
    };

    if (config.verifierCookieName) {
      const codeVerifier =
        randomBytes(PKCE_VERIFIER_RANDOM_BYTES).toString("base64url");
      codeChallenge = createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");
      cookieStore.set(config.verifierCookieName, codeVerifier, cookieOptions);
    }

    cookieStore.set(config.stateCookieName, state, cookieOptions);

    const authorizeUrlResult = config.buildAuthorizeUrl(state, codeChallenge);
    if (!authorizeUrlResult.ok) {
      console.error(`${logPrefix} ${authorizeUrlResult.message}`);
      return NextResponse.json(
        { success: false, message: authorizeUrlResult.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      authUrl: authorizeUrlResult.url,
    });
  } catch (error) {
    console.error(`${logPrefix} OAuth initiation error:`, error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
