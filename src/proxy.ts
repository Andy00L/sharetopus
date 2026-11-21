import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import {
  REFERRAL_CODE_PATTERN,
  REFERRAL_COOKIE_MAX_AGE_SECONDS,
  REFERRAL_COOKIE_NAME,
} from "@/lib/referral/referralRules";

// MCP and OAuth discovery routes must be publicly accessible.
// The MCP handler does its own auth via Bearer tokens, but still needs
// clerkMiddleware to have run: its OAuth resolver calls auth() with
// acceptsToken "oauth_token" (src/lib/mcp/auth/resolvers/oauth.ts).
//
// The x402 and Solana Actions lanes are NOT listed here: they are excluded
// from `config.matcher` below so Clerk never sees their requests at all.
const isPublicRoute = createRouteMatcher([
  "/api/mcp/(.*)",
  "/.well-known/oauth-protected-resource(.*)",
  "/.well-known/oauth-authorization-server(.*)",
]);

const isProtectedRoute = createRouteMatcher([
  "/accounts(.*)",
  "/config(.*)",
  "/connections(.*)",
  "/create(.*)",
  "/dashboard(.*)",
  "/posts(.*)",
  "/posted(.*)",
  "/scheduled(.*)",
  "/schedule(.*)",
  "/studio(.*)",
  "/userProfile(.*)",
  "/integrations(.*)",
  "/referral(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  // Clerk's auth.protect() redirects a signed-out visitor to sign-in and drops
  // the query string, so a ?ref= code is read only on unprotected routes.
  const refCode = req.nextUrl.searchParams.get("ref");
  if (
    refCode &&
    !isProtectedRoute(req) &&
    !req.cookies.has(REFERRAL_COOKIE_NAME) &&
    REFERRAL_CODE_PATTERN.test(refCode)
  ) {
    const response = NextResponse.next();
    response.cookies.set({
      name: REFERRAL_COOKIE_NAME,
      value: refCode,
      maxAge: REFERRAL_COOKIE_MAX_AGE_SECONDS,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
    return response;
  }

  if (isPublicRoute(req)) return;
  if (isProtectedRoute(req)) await auth.protect();
});

// Clerk's auth() throws unless clerkMiddleware ran for the request, so only
// routes whose code never calls auth() or currentUser() may skip this proxy.
// Skipped API prefixes:
// - x402 and Solana Actions (Blink): clerkMiddleware parses any
//   `Authorization: Bearer` header before the handler runs and throws on a
//   token that looks like a JWT but is not one, and the x402 connection token
//   (`v1.<payload>.<signature>`) is exactly that shape.
// - inngest, webhooks, v1, media, docs and oauth/callback: authenticated by
//   signatures, API keys, signed URLs or OAuth state, never by a Clerk session.
//
// The exclusions are repeated in both entries as literals: Next.js reads
// `matcher` statically at build time and ignores values built from variables.
export const config = {
  matcher: [
    "/((?!_next|api/(?:x402|actions|inngest|webhooks|v1|media|docs|oauth/callback)(?:/|$)|actions\\.json$|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|avif|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|webm|mp3|txt|xml|pdf)).*)",
    "/((?!api/(?:x402|actions|inngest|webhooks|v1|media|docs|oauth/callback)(?:/|$))(?:api|trpc).*)",
  ],
};
