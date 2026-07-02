import { initiateWebOAuth } from "@/lib/api/oauth/web/initiateWebOAuth";
import type { NextResponse } from "next/server";

/**
 * POST /api/social/facebook/initiate
 *
 * Starts the Facebook Login popup flow for Page publishing.
 * sourceRef: https://developers.facebook.com/docs/pages-api/getting-started/
 */
export async function POST(): Promise<NextResponse> {
  return initiateWebOAuth({
    platform: "facebook",
    stateCookieName: "facebook_auth_state",
    buildAuthorizeUrl: (state) => {
      const clientId = process.env.FACEBOOK_CLIENT_ID;
      const redirectUri = process.env.FACEBOOK_REDIRECT_URL;
      if (!clientId) {
        return { ok: false, message: "FACEBOOK_CLIENT_ID is not configured." };
      }
      if (!redirectUri) {
        return {
          ok: false,
          message: "FACEBOOK_REDIRECT_URL is not configured.",
        };
      }

      // pages_show_list exposes /me/accounts; pages_manage_posts publishes;
      // pages_read_engagement is required alongside manage_posts.
      const scopes = [
        "pages_show_list",
        "pages_manage_posts",
        "pages_read_engagement",
      ].join(",");

      // Graph dialog version matches GRAPH_API_VERSION in exchangeFacebookCode.ts.
      const url =
        `https://www.facebook.com/v23.0/dialog/oauth` +
        `?client_id=${clientId}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&state=${state}`;

      return { ok: true, url };
    },
  });
}
