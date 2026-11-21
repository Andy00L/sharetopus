import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { Platform } from "./types";

/** 48 random bytes base64url-encode to 64 chars, inside the RFC 7636 43-128 range. */
const PKCE_VERIFIER_RANDOM_BYTES = 48;

export interface BuildOAuthUrlInput {
  platform: Platform;
  state: string;
  redirectUri: string;
}

export type BuildOAuthUrlResult =
  | {
      ok: true;
      url: string;
      codeVerifier: string | null;
    }
  | {
      ok: false;
      error: "missing_client_id" | "unsupported_platform";
      message: string;
    };

export function buildOAuthUrl(input: BuildOAuthUrlInput): BuildOAuthUrlResult {
  switch (input.platform) {
    case "linkedin":
      return buildLinkedInUrl(input);
    case "tiktok":
      return buildTikTokUrl(input);
    case "pinterest":
      return buildPinterestUrl(input);
    case "instagram":
      return buildInstagramUrl(input);
    case "youtube":
      return buildYouTubeUrl(input);
    case "x":
      return buildXUrl(input);
    case "facebook":
      return buildFacebookUrl(input);
    default: {
      const _exhaustive: never = input.platform;
      return {
        ok: false,
        error: "unsupported_platform",
        message: `Unsupported platform: ${String(_exhaustive)}`,
      };
    }
  }
}

function buildLinkedInUrl(input: BuildOAuthUrlInput): BuildOAuthUrlResult {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) {
    console.error("[buildOAuthUrl] LINKEDIN_CLIENT_ID env var not set.");
    return {
      ok: false,
      error: "missing_client_id",
      message: "LINKEDIN_CLIENT_ID is not configured.",
    };
  }

  const scopes = ["openid", "profile", "w_member_social"].join(" ");

  const url =
    `https://www.linkedin.com/oauth/v2/authorization` +
    `?client_id=${clientId}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(input.redirectUri)}` +
    `&state=${input.state}` +
    `&response_type=code` +
    `&prompt=consent_and_login` +
    `&auth_type=reauthenticate`;

  return { ok: true, url, codeVerifier: null };
}

function buildTikTokUrl(input: BuildOAuthUrlInput): BuildOAuthUrlResult {
  const clientKey =
    process.env.NODE_ENV === "development"
      ? process.env.TIKTOK_CLIENT_KEY_DEV
      : process.env.TIKTOK_CLIENT_KEY;

  if (!clientKey) {
    console.error("[buildOAuthUrl] TIKTOK_CLIENT_KEY env var not set.");
    return {
      ok: false,
      error: "missing_client_id",
      message: "TIKTOK_CLIENT_KEY is not configured.",
    };
  }

  const scopes = "user.info.basic,user.info.profile,video.publish,user.info.stats";

  const url =
    `https://www.tiktok.com/v2/auth/authorize/` +
    `?client_key=${clientKey}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(input.redirectUri)}` +
    `&state=${input.state}` +
    `&response_type=code` +
    `&disable_auto_auth=1`;

  return { ok: true, url, codeVerifier: null };
}

function buildPinterestUrl(input: BuildOAuthUrlInput): BuildOAuthUrlResult {
  const clientId = process.env.PINTEREST_CLIENT_ID;
  if (!clientId) {
    console.error("[buildOAuthUrl] PINTEREST_CLIENT_ID env var not set.");
    return {
      ok: false,
      error: "missing_client_id",
      message: "PINTEREST_CLIENT_ID is not configured.",
    };
  }

  const scopes = [
    "boards:read",
    "boards:write",
    "pins:read",
    "pins:write",
    "user_accounts:read",
  ].join(",");

  const url =
    `https://www.pinterest.com/oauth/` +
    `?client_id=${clientId}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(input.redirectUri)}` +
    `&state=${input.state}` +
    `&response_type=code` +
    `&prompt=login` +
    `&auth_type=reauthenticate`;

  return { ok: true, url, codeVerifier: null };
}

function buildInstagramUrl(input: BuildOAuthUrlInput): BuildOAuthUrlResult {
  const clientId = process.env.INSTAGRAM_CLIENT_ID;
  if (!clientId) {
    console.error("[buildOAuthUrl] INSTAGRAM_CLIENT_ID env var not set.");
    return {
      ok: false,
      error: "missing_client_id",
      message: "INSTAGRAM_CLIENT_ID is not configured.",
    };
  }

  const scopes = [
    "instagram_business_basic",
    "instagram_business_content_publish",
  ].join(",");

  const url =
    `https://www.instagram.com/oauth/authorize` +
    `?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(input.redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&state=${input.state}` +
    `&enable_fb_login=0` +
    `&force_authentication=1`;

  return { ok: true, url, codeVerifier: null };
}

function buildYouTubeUrl(input: BuildOAuthUrlInput): BuildOAuthUrlResult {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId) {
    console.error("[buildOAuthUrl] YOUTUBE_CLIENT_ID env var not set.");
    return {
      ok: false,
      error: "missing_client_id",
      message: "YOUTUBE_CLIENT_ID is not configured.",
    };
  }

  // Google returns a refresh token only on the first consent; prompt=consent asks again
  // (developers.google.com/identity/protocols/oauth2/web-server).
  const scopes = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
  ].join(" ");

  const url =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(input.redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&state=${input.state}` +
    `&access_type=offline` +
    `&prompt=consent`;

  return { ok: true, url, codeVerifier: null };
}

function buildXUrl(input: BuildOAuthUrlInput): BuildOAuthUrlResult {
  const clientId = process.env.X_CLIENT_ID;
  if (!clientId) {
    console.error("[buildOAuthUrl] X_CLIENT_ID env var not set.");
    return {
      ok: false,
      error: "missing_client_id",
      message: "X_CLIENT_ID is not configured.",
    };
  }

  // X requires PKCE (docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code).
  const codeVerifier =
    randomBytes(PKCE_VERIFIER_RANDOM_BYTES).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  const scopes = [
    "tweet.read",
    "tweet.write",
    "users.read",
    "media.write",
    "offline.access",
  ].join(" ");

  const url =
    `https://x.com/i/oauth2/authorize` +
    `?response_type=code` +
    `&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(input.redirectUri)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&state=${input.state}` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256`;

  return { ok: true, url, codeVerifier };
}

function buildFacebookUrl(input: BuildOAuthUrlInput): BuildOAuthUrlResult {
  const clientId = process.env.FACEBOOK_CLIENT_ID;
  if (!clientId) {
    console.error("[buildOAuthUrl] FACEBOOK_CLIENT_ID env var not set.");
    return {
      ok: false,
      error: "missing_client_id",
      message: "FACEBOOK_CLIENT_ID is not configured.",
    };
  }

  const scopes = [
    "pages_show_list",
    "pages_manage_posts",
    "pages_read_engagement",
  ].join(",");

  const url =
    `https://www.facebook.com/v23.0/dialog/oauth` +
    `?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(input.redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&state=${input.state}`;

  return { ok: true, url, codeVerifier: null };
}
