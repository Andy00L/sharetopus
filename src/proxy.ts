import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// MCP and OAuth discovery routes must be publicly accessible.
// The MCP handler does its own auth via Bearer tokens.
const isPublicRoute = createRouteMatcher([
  "/api/mcp/(.*)",
  "/api/x402/(.*)",
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

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
