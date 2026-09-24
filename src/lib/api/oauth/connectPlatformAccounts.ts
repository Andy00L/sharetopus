import "server-only";

import type { Json, social_accounts } from "@/db/schema";
import { exchangeFacebookCode } from "@/lib/api/facebook/data/exchangeFacebookCode";
import { getFacebookPages } from "@/lib/api/facebook/data/getFacebookPages";
import { exchangeInstagramCode } from "@/lib/api/instagram/data/exchangeInstagramCode";
import { getInstagramProfile } from "@/lib/api/instagram/data/getInstagramProfile";
import { exchangeLinkedInCode } from "@/lib/api/linkedin/data/exchangeLinkedInCode";
import { getLinkedInProfile } from "@/lib/api/linkedin/data/getLinkedInProfile";
import { exchangePinterestCode } from "@/lib/api/pinterest/data/exchangePinterestCode";
import { getPinterestProfile } from "@/lib/api/pinterest/data/getPinterestProfile";
import { exchangeTikTokCode } from "@/lib/api/tiktok/data/exchangeTikTokCode";
import { getTikTokProfile } from "@/lib/api/tiktok/data/getTikTokProfile";
import { exchangeXCode } from "@/lib/api/x/data/exchangeXCode";
import { getXProfile } from "@/lib/api/x/data/getXProfile";
import { exchangeYouTubeCode } from "@/lib/api/youtube/data/exchangeYouTubeCode";
import { getYouTubeProfile } from "@/lib/api/youtube/data/getYouTubeProfile";
import type { PostingPlatform } from "@/lib/platforms/capabilities";

/** One connected account normalized for the social_accounts upsert. */
export interface NormalizedConnectedAccount {
  accountIdentifier: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  emailAddress: string | null;
  accessToken: string;
  refreshToken: string | null;
  /** ISO expiry; null means the token never expires (Facebook Page tokens). */
  tokenExpiresAt: string | null;
  extra: Json;
  /**
   * Profile columns for platforms whose profile call returns them. Omitted,
   * the upsert leaves those columns untouched.
   */
  profileStats?: {
    isVerified: boolean;
    bioDescription: string | null;
    followerCount: number | null;
    followingCount: number | null;
  };
}

export type ConnectAccountsResult =
  | { success: true; accounts: NormalizedConnectedAccount[] }
  | { success: false; message: string };

export interface ConnectAccountsInput {
  code: string;
  /** The exact redirect URI the authorize URL carried. */
  redirectUri: string;
  /** The PKCE verifier; required by X, null elsewhere. */
  codeVerifier: string | null;
}

/**
 * Exchanges an OAuth code and reads the connected account(s) for one of the
 * seven dedicated platforms. Facebook returns one entry per managed Page;
 * every other platform returns exactly one.
 *
 * Both connect flows go through here, so an account gets the same
 * identifier (and the same row) whichever flow connected it:
 *   - completeWebOAuthConnect: the web popup, redirect URI from env
 *   - handleOAuthCallback: x402, REST and share links, redirect URI from
 *     the social_connections row
 */
export async function connectPlatformAccounts(
  platform: PostingPlatform,
  input: ConnectAccountsInput,
): Promise<ConnectAccountsResult> {
  switch (platform) {
    case "linkedin":
      return connectLinkedInAccount(input);
    case "tiktok":
      return connectTikTokAccount(input);
    case "pinterest":
      return connectPinterestAccount(input);
    case "instagram":
      return connectInstagramAccount(input);
    case "youtube":
      return connectYouTubeAccount(input);
    case "x":
      return connectXAccount(input);
    case "facebook":
      return connectFacebookPages(input);
  }
}

/**
 * The social_accounts values for one connected account. Both connect flows
 * upsert with them, so a reconnect through either flow updates the row the
 * same way.
 */
export function buildSocialAccountValues(
  principalId: string,
  platform: PostingPlatform,
  account: NormalizedConnectedAccount,
) {
  return {
    principal_id: principalId,
    platform,
    account_identifier: account.accountIdentifier,
    is_available: true,
    display_name: account.displayName,
    username: account.username,
    avatar_url: account.avatarUrl,
    email_address: account.emailAddress,
    access_token: account.accessToken,
    refresh_token: account.refreshToken,
    token_expires_at: account.tokenExpiresAt,
    extra: account.extra,
    updated_at: new Date().toISOString(),
    ...(account.profileStats
      ? {
          is_verified: account.profileStats.isVerified,
          bio_description: account.profileStats.bioDescription,
          follower_count: account.profileStats.followerCount,
          following_count: account.profileStats.followingCount,
        }
      : {}),
  } satisfies typeof social_accounts.$inferInsert;
}

function toTokenExpiresAt(expiresInSeconds: number): string {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

/** LinkedIn exposes no handle, so the member's name stands in for username. */
async function connectLinkedInAccount(
  input: ConnectAccountsInput,
): Promise<ConnectAccountsResult> {
  const exchangeResult = await exchangeLinkedInCode(input.code, input.redirectUri);
  if (!exchangeResult.success) {
    return { success: false, message: exchangeResult.message };
  }
  const tokens = exchangeResult.data;

  const profileResult = await getLinkedInProfile(tokens.access_token);
  if (!profileResult.success) {
    return { success: false, message: profileResult.message };
  }
  const profile = profileResult.data;

  return {
    success: true,
    accounts: [
      {
        accountIdentifier: profile.id,
        displayName: profile.name || null,
        username: profile.name || null,
        avatarUrl: profile.picture || null,
        emailAddress: profile.email || null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        tokenExpiresAt: toTokenExpiresAt(tokens.expires_in),
        extra: {
          scope: tokens.scope ?? null,
          locale: profile.locale || null,
          email_verified: profile.email_verified,
        },
      },
    ],
  };
}

/**
 * The open_id from the token answer is the identity, so a creator who
 * withheld the profile scopes still connects, with placeholder fields.
 */
async function connectTikTokAccount(
  input: ConnectAccountsInput,
): Promise<ConnectAccountsResult> {
  const exchangeResult = await exchangeTikTokCode(input.code, input.redirectUri);
  if (!exchangeResult.success) {
    return { success: false, message: exchangeResult.message };
  }
  const tokens = exchangeResult.data;
  if (!tokens.open_id) {
    return { success: false, message: "TikTok returned no account id." };
  }

  // Never throws: a failed call returns placeholder fields.
  const profile = await getTikTokProfile(tokens.access_token, tokens.open_id);

  return {
    success: true,
    accounts: [
      {
        accountIdentifier: tokens.open_id,
        displayName: profile.display_name,
        username: profile.username,
        avatarUrl: profile.avatar_url,
        emailAddress: null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        tokenExpiresAt: toTokenExpiresAt(tokens.expires_in),
        profileStats: {
          isVerified: profile.is_verified,
          bioDescription: profile.bio_description,
          followerCount: profile.follower_count,
          followingCount: profile.following_count,
        },
        extra: {
          profile,
          token_info: {
            scope: tokens.scope ?? null,
            token_type: tokens.token_type ?? null,
            refresh_expires_in: tokens.refresh_expires_in ?? null,
          },
        },
      },
    ],
  };
}

/**
 * The account id is the identity, so a profile that cannot be read fails
 * the connect instead of storing an account with an empty identifier.
 */
async function connectPinterestAccount(
  input: ConnectAccountsInput,
): Promise<ConnectAccountsResult> {
  const exchangeResult = await exchangePinterestCode(input.code, input.redirectUri);
  if (!exchangeResult.success) {
    return { success: false, message: exchangeResult.message };
  }
  const tokens = exchangeResult.data;

  // Never throws: a failed call returns a placeholder with an empty id.
  const profile = await getPinterestProfile(tokens.access_token);
  if (!profile.id) {
    return { success: false, message: "Could not read the Pinterest account." };
  }

  return {
    success: true,
    accounts: [
      {
        accountIdentifier: profile.id,
        displayName: profile.business_name || profile.username || null,
        username: profile.username || null,
        avatarUrl: profile.profile_image_url,
        emailAddress: null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        tokenExpiresAt: toTokenExpiresAt(tokens.expires_in),
        profileStats: {
          isVerified: profile.is_verified,
          bioDescription: profile.bio,
          followerCount: profile.follower_count,
          followingCount: profile.following_count,
        },
        extra: {
          profile,
          token_info: {
            scope: tokens.scope ?? null,
            token_type: tokens.token_type ?? null,
          },
        },
      },
    ],
  };
}

/**
 * Keyed on the /me user_id, the professional account ID postToInstagram
 * publishes under. Instagram Login issues no refresh token: the long-lived
 * access token refreshes itself (refreshInstagramToken).
 */
async function connectInstagramAccount(
  input: ConnectAccountsInput,
): Promise<ConnectAccountsResult> {
  const exchangeResult = await exchangeInstagramCode(input.code, input.redirectUri);
  if (!exchangeResult.success) {
    return { success: false, message: exchangeResult.message };
  }
  const tokens = exchangeResult.data;

  const profileResult = await getInstagramProfile(tokens.access_token);
  if (!profileResult.success) {
    return { success: false, message: profileResult.message };
  }
  const profile = profileResult.data;

  return {
    success: true,
    accounts: [
      {
        accountIdentifier: profile.id,
        displayName: profile.name || profile.username,
        username: profile.username,
        avatarUrl: profile.profile_picture_url,
        emailAddress: null,
        accessToken: tokens.access_token,
        refreshToken: null,
        tokenExpiresAt: toTokenExpiresAt(tokens.expires_in),
        profileStats: {
          isVerified: false,
          bioDescription: null,
          followerCount: profile.followers_count,
          followingCount: profile.follows_count,
        },
        extra: {
          scope: tokens.scope ?? null,
          account_type: profile.account_type,
        },
      },
    ],
  };
}

/** The channel id is the identity, so the channel read is required. */
async function connectYouTubeAccount(
  input: ConnectAccountsInput,
): Promise<ConnectAccountsResult> {
  const exchangeResult = await exchangeYouTubeCode(input.code, input.redirectUri);
  if (!exchangeResult.success) {
    return { success: false, message: exchangeResult.message };
  }
  const tokens = exchangeResult.data;

  const profileResult = await getYouTubeProfile(tokens.access_token);
  if (!profileResult.success) {
    return { success: false, message: profileResult.message };
  }
  const channel = profileResult.data;

  return {
    success: true,
    accounts: [
      {
        accountIdentifier: channel.channelId,
        displayName: channel.title,
        username: channel.customUrl ?? channel.title,
        avatarUrl: channel.avatarUrl,
        emailAddress: null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        tokenExpiresAt: toTokenExpiresAt(tokens.expires_in),
        extra: {
          scope: tokens.scope ?? null,
          subscriber_count: channel.subscriberCount,
        },
      },
    ],
  };
}

/** The user id is the identity, so the user read is required. */
async function connectXAccount(
  input: ConnectAccountsInput,
): Promise<ConnectAccountsResult> {
  const exchangeResult = await exchangeXCode(
    input.code,
    input.redirectUri,
    input.codeVerifier,
  );
  if (!exchangeResult.success) {
    return { success: false, message: exchangeResult.message };
  }
  const tokens = exchangeResult.data;

  const profileResult = await getXProfile(tokens.access_token);
  if (!profileResult.success) {
    return { success: false, message: profileResult.message };
  }
  const user = profileResult.data;

  return {
    success: true,
    accounts: [
      {
        accountIdentifier: user.id,
        displayName: user.name,
        username: user.username,
        avatarUrl: user.avatarUrl,
        emailAddress: null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        tokenExpiresAt: toTokenExpiresAt(tokens.expires_in),
        extra: {
          scope: tokens.scope ?? null,
          is_verified: user.isVerified,
        },
      },
    ],
  };
}

/**
 * One account per managed Page. The PAGE token is what every publish call
 * uses; page tokens minted from a long-lived user token do not expire, and
 * the user token itself is stored nowhere.
 */
async function connectFacebookPages(
  input: ConnectAccountsInput,
): Promise<ConnectAccountsResult> {
  const exchangeResult = await exchangeFacebookCode(input.code, input.redirectUri);
  if (!exchangeResult.success) {
    return { success: false, message: exchangeResult.message };
  }

  const pagesResult = await getFacebookPages(exchangeResult.data.access_token);
  if (!pagesResult.success) {
    return { success: false, message: pagesResult.message };
  }

  return {
    success: true,
    accounts: pagesResult.pages.map((page) => ({
      accountIdentifier: page.pageId,
      displayName: page.name,
      username: page.name,
      avatarUrl: page.avatarUrl,
      emailAddress: null,
      accessToken: page.pageAccessToken,
      refreshToken: null,
      tokenExpiresAt: null,
      extra: {
        category: page.category,
      },
    })),
  };
}
