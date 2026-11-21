import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { checkAccountLimits } from "@/actions/server/connections/checkAccountLimits";
import type { Platform } from "@/db/schema";
import { auth } from "@clerk/nextjs/server";
import { nanoid } from "nanoid";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const OAUTH_COOKIE_MAX_AGE_SECONDS = 60 * 15;
// 48 random bytes base64url-encode to 64 characters; RFC 7636 section 4.1 allows
// a code_verifier of 43 to 128 characters.
const PKCE_VERIFIER_RANDOM_BYTES = 48;

export interface WebOAuthInitiateConfig {
  platform: Platform;
  stateCookieName: string;
  verifierCookieName?: string;
  buildAuthorizeUrl: (
    state: string,
    codeChallenge: string | null,
  ) => { ok: true; url: string } | { ok: false; message: string };
}

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
    if (subscriptionCheck.status === "unavailable") {
      return NextResponse.json(
        {
          success: false,
          message: "Could not check your subscription. Please try again.",
        },
        { status: 503 },
      );
    }
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
