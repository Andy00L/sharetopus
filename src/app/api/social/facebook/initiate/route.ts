import { META_GRAPH_API_VERSION } from "@/lib/api/_shared/metaGraphApiVersion";
import { initiateWebOAuth } from "@/lib/api/oauth/web/initiateWebOAuth";
import type { NextResponse } from "next/server";

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

      // pages_manage_posts depends on pages_read_engagement and pages_show_list:
      // https://developers.facebook.com/docs/permissions
      const scopes = [
        "pages_show_list",
        "pages_manage_posts",
        "pages_read_engagement",
      ].join(",");

      const url =
        `https://www.facebook.com/${META_GRAPH_API_VERSION}/dialog/oauth` +
        `?client_id=${clientId}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&state=${state}`;

      return { ok: true, url };
    },
  });
}
