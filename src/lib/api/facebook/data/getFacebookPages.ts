import "server-only";

import { z } from "zod";

import type { FacebookPage } from "@/lib/types/socialProfiles";

/** Outbound Graph API calls are bounded to 15s. */
const PAGES_TIMEOUT_MS = 15_000;

/** Graph API version pinned across the repo; see exchangeFacebookCode.ts. */
const GRAPH_API_VERSION = "v23.0";

/**
 * GET /me/accounts response (fields this module requests).
 * sourceRef: https://developers.facebook.com/docs/pages-api/getting-started/
 */
const FacebookAccountsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      access_token: z.string().min(1),
      category: z.string().optional(),
      picture: z
        .object({
          data: z.object({ url: z.string().optional() }).optional(),
        })
        .optional(),
    }),
  ),
});

export type FacebookPagesResult =
  | { success: true; pages: FacebookPage[] }
  | { success: false; message: string };

/**
 * List the Pages the user manages, each with its Page access token. Page
 * tokens returned for a long-lived user token do not expire, so
 * social_accounts rows for Facebook store token_expires_at = null.
 *
 * Posting requires at least one Page: a user with zero Pages cannot be
 * connected and the caller must fail the connect flow.
 *
 * Called by: /api/social/facebook/connect, facebookTokenExchange (x402 flow)
 */
export async function getFacebookPages(
  userAccessToken: string,
): Promise<FacebookPagesResult> {
  const url =
    `https://graph.facebook.com/${GRAPH_API_VERSION}/me/accounts` +
    `?fields=id,name,access_token,category,picture{url}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${userAccessToken}` },
      signal: AbortSignal.timeout(PAGES_TIMEOUT_MS),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(
        `[getFacebookPages] HTTP ${response.status}: ${responseText}`,
      );
      return {
        success: false,
        message: `Facebook pages fetch failed (${response.status}).`,
      };
    }

    const parsed = FacebookAccountsSchema.safeParse(JSON.parse(responseText));
    if (!parsed.success) {
      console.error("[getFacebookPages] Pages response failed validation.");
      return {
        success: false,
        message: "Facebook pages response had an unexpected shape.",
      };
    }

    if (parsed.data.data.length === 0) {
      return {
        success: false,
        message:
          "No Facebook Pages found for this account. Posting requires a Page you manage.",
      };
    }

    const pages: FacebookPage[] = parsed.data.data.map((pageEntry) => ({
      pageId: pageEntry.id,
      name: pageEntry.name,
      pageAccessToken: pageEntry.access_token,
      category: pageEntry.category ?? null,
      avatarUrl: pageEntry.picture?.data?.url ?? null,
    }));

    return { success: true, pages };
  } catch (error) {
    console.error(
      "[getFacebookPages] Pages fetch error:",
      error instanceof Error ? error.message : error,
    );
    return { success: false, message: "Facebook pages fetch request failed." };
  }
}
