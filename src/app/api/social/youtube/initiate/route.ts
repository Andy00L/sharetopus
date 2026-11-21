import { initiateWebOAuth } from "@/lib/api/oauth/web/initiateWebOAuth";
import type { NextResponse } from "next/server";

export async function POST(): Promise<NextResponse> {
  return initiateWebOAuth({
    platform: "youtube",
    stateCookieName: "youtube_auth_state",
    buildAuthorizeUrl: (state) => {
      const clientId = process.env.YOUTUBE_CLIENT_ID;
      const redirectUri = process.env.YOUTUBE_REDIRECT_URL;
      if (!clientId) {
        return { ok: false, message: "YOUTUBE_CLIENT_ID is not configured." };
      }
      if (!redirectUri) {
        return {
          ok: false,
          message: "YOUTUBE_REDIRECT_URL is not configured.",
        };
      }

      const scopes = [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
      ].join(" ");

      // Google returns a refresh token only for access_type=offline, and
      // prompt=consent makes it issue a new one on a reconnect:
      // https://developers.google.com/identity/protocols/oauth2/web-server#offline
      const url =
        `https://accounts.google.com/o/oauth2/v2/auth` +
        `?client_id=${clientId}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&state=${state}` +
        `&access_type=offline` +
        `&prompt=consent`;

      return { ok: true, url };
    },
  });
}
