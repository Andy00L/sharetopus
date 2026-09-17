import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

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

// Create a matcher for all protected routes
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
  // --- Referral cookie: first-touch attribution ---
  // On any non-protected request carrying a valid ?ref= code and no existing
  // stx_ref cookie, stamp the attribution cookie. Read during signup
  // (ensureUserExists -> recordReferralOnSignup) to record the referral.
  // Protected routes are excluded because auth.protect() may redirect to
  // the login page, losing the query param. The referral link targets the
  // homepage: /?ref=CODE
  const refCode = req.nextUrl.searchParams.get("ref");
  if (
    refCode &&
    !isProtectedRoute(req) &&
    !req.cookies.has("stx_ref") &&
    /^[A-Z0-9]{1,16}$/.test(refCode)
  ) {
    const response = NextResponse.next();
    response.cookies.set({
      name: "stx_ref",
      value: refCode,
      maxAge: 2592000, // 30 days
      sameSite: "lax",
      secure: true,
      path: "/",
    });
    return response;
  }

  if (isPublicRoute(req)) return;
  if (isProtectedRoute(req)) await auth.protect();
});

// The x402 lane and the Solana Actions (Blink) lane never use Clerk. They are
// kept out of the matcher entirely, not just short-circuited inside the
// handler above: clerkMiddleware parses any `Authorization: Bearer` header
// before the handler runs and throws on a token that looks like a JWT but is
// not one. The x402 connection token (`v1.<payload>.<signature>`) is exactly
// that shape, so GET /api/x402/oauth/status answered a plain 500 to every
// agent polling it. Paid x402 calls were unaffected because they carry
// PAYMENT-SIGNATURE, not Authorization.
//
// The exclusion `api/x402(?:/|$)|api/actions(?:/|$)|actions\.json$` is
// repeated in both entries as a literal: Next.js reads `matcher` statically
// at build time and ignores values built from variables.
export const config = {
  matcher: [
    // Skip Next.js internals, the machine lanes, and all static files, unless found in search params
    "/((?!_next|api/x402(?:/|$)|api/actions(?:/|$)|actions\\.json$|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes, except the machine lanes
    "/((?!api/x402(?:/|$)|api/actions(?:/|$))(?:api|trpc).*)",
  ],
};
