import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import type { NextRequest, NextResponse } from "next/server";

/** OAuth popup callback for the X web connect flow (PKCE). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "x",
    stateCookieName: "x_auth_state",
    verifierCookieName: "x_auth_verifier",
    redirectUri: process.env.X_REDIRECT_URL,
  });
}
