import "server-only";

import { exchangeFacebookCode } from "@/lib/api/facebook/data/exchangeFacebookCode";
import { getFacebookPages } from "@/lib/api/facebook/data/getFacebookPages";

export interface FacebookExchangeResult {
  ok: true;
  accessToken: string;
  refreshToken: string | null;
  /** Facebook Page tokens do not expire; always null here. */
  expiresIn: number | null;
  accountIdentifier: string;
  profile: {
    name?: string;
    username?: string;
    avatarUrl?: string;
  };
}

export type ExchangeFacebookForX402Result =
  | FacebookExchangeResult
  | { ok: false; error: "exchange_failed" | "profile_fetch_failed"; message: string };

/**
 * Exchange a Facebook Login code for the FIRST managed Page + its Page
 * token.
 *
 * Reuses the shared web-flow helpers with X402_FACEBOOK_REDIRECT_URI as
 * the redirect. handleOAuthCallback upserts exactly ONE social_accounts
 * row per connection, so when the user manages several Pages only the
 * first is stored here; the extra Pages are logged and can be connected
 * through the web flow, which stores one row per Page.
 *
 * Called by: handleOAuthCallback
 */
export async function exchangeFacebookForX402(
  code: string,
): Promise<ExchangeFacebookForX402Result> {
  const redirectUri = process.env.X402_FACEBOOK_REDIRECT_URI;
  if (!redirectUri) {
    console.error(
      "[exchangeFacebookForX402] X402_FACEBOOK_REDIRECT_URI not set.",
    );
    return {
      ok: false,
      error: "exchange_failed",
      message: "Facebook configuration missing.",
    };
  }

  const exchangeResult = await exchangeFacebookCode(code, redirectUri);
  if (!exchangeResult.success) {
    return {
      ok: false,
      error: "exchange_failed",
      message: exchangeResult.message,
    };
  }

  const pagesResult = await getFacebookPages(exchangeResult.data.access_token);
  if (!pagesResult.success) {
    return {
      ok: false,
      error: "profile_fetch_failed",
      message: pagesResult.message,
    };
  }

  const [firstPage, ...remainingPages] = pagesResult.pages;
  if (remainingPages.length > 0) {
    console.warn(
      `[exchangeFacebookForX402] User manages ${pagesResult.pages.length} Pages; storing the first (${firstPage.pageId}) per the single-account connection contract.`,
    );
  }

  return {
    ok: true,
    accessToken: firstPage.pageAccessToken,
    refreshToken: null,
    expiresIn: null,
    accountIdentifier: firstPage.pageId,
    profile: {
      name: firstPage.name,
      username: firstPage.name,
      avatarUrl: firstPage.avatarUrl ?? undefined,
    },
  };
}
