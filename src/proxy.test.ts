import { describe, expect, mock, test } from "bun:test";
import { tryToParsePath } from "next/dist/lib/try-to-parse-path";

mock.module("@clerk/nextjs/server", () => ({
  clerkMiddleware: (handler: unknown) => handler,
  createRouteMatcher: () => () => false,
}));

const { config } = await import("./proxy");

const PROXY_PATTERNS = config.matcher.map((source) => {
  const { regexStr } = tryToParsePath(source);
  if (regexStr === undefined) {
    throw new Error(`[compileProxyPatterns] matcher did not parse: ${source}`);
  }
  return new RegExp(regexStr);
});

function isProxied(pathname: string): boolean {
  return PROXY_PATTERNS.some((pattern) => pattern.test(pathname));
}

describe("proxy matcher", () => {
  test.each([
    "/",
    "/dashboard",
    "/create/video",
    "/docs/x402",
    "/.well-known/oauth-protected-resource",
    "/api/mcp/mcp",
    "/api/social/x/initiate",
    "/api/social/registry/reddit/callback",
    "/api/posts/status",
    "/api/storage/generate-upload-url",
    "/api/mediakit",
    "/api/v12/posts",
    "/api/webhooksx",
  ])("runs Clerk on %s", (pathname) => {
    expect(isProxied(pathname)).toBe(true);
  });

  test.each([
    "/api/inngest",
    "/api/webhooks/stripe",
    "/api/webhooks/tiktok/publish",
    "/api/v1/posts",
    "/api/v1/openapi.json",
    "/api/media",
    "/api/docs/mcp",
    "/api/oauth/callback/linkedin",
    "/api/x402",
    "/api/x402/connect",
    "/api/actions/post-now",
    "/actions.json",
    "/manage.mp4",
    "/scheduling.webm",
    "/sitemap.xml",
    "/robots.txt",
    "/llms.txt",
    "/logo.png",
    "/_next/static/chunks/main.js",
  ])("skips %s", (pathname) => {
    expect(isProxied(pathname)).toBe(false);
  });
});
