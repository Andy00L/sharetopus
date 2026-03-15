import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
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
]);
export default clerkMiddleware(async (auth, req) => {
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
