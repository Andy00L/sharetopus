import "server-only";

import type { Platform } from "./types";

export interface BuildOAuthUrlInput {
  platform: Platform;
  state: string;
  redirectUri: string;
}

export type BuildOAuthUrlResult =
  | { ok: true; url: string }
  | {
      ok: false;
      error: "missing_client_id" | "unsupported_platform";
      message: string;
    };

/**
 * Builds the OAuth authorization URL for the given platform.
 *
 * Reads client ID from per-platform env vars. Scopes and auth URLs mirror
 * the existing initiate routes exactly.
 */
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
    default: {
      const _exhaustive: never = input.platform;
      void _exhaustive;
      return {
        ok: false,
        error: "unsupported_platform",
        message: `Unsupported platform: ${input.platform as string}`,
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

  const scopes = ["openid", "profile", "email", "w_member_social"].join(" ");

  const url =
    `https://www.linkedin.com/oauth/v2/authorization` +
    `?client_id=${clientId}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(input.redirectUri)}` +
    `&state=${input.state}` +
    `&response_type=code` +
    `&prompt=consent_and_login` +
    `&auth_type=reauthenticate`;

  return { ok: true, url };
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

  const scopes =
    "user.info.basic,user.info.profile,video.publish,video.upload,user.info.stats";

  const url =
    `https://www.tiktok.com/v2/auth/authorize/` +
    `?client_key=${clientKey}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(input.redirectUri)}` +
    `&state=${input.state}` +
    `&response_type=code` +
    `&force_login=true` +
    `&auth_type=reauthenticate` +
    `&timestamp=${Date.now()}`;

  return { ok: true, url };
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
    "catalogs:read",
    "catalogs:write",
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

  return { ok: true, url };
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

  return { ok: true, url };
}
