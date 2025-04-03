// lib/tiktok/auth.ts
import { TIKTOK_API_CONFIG } from "./config";
import { nanoid } from "nanoid";
import axios from "axios";

export type TikTokTokenResponse = {
  access_token: string;
  refresh_token?: string;
  open_id: string;
  scope: string;
  expires_in: number;
  refresh_expires_in?: number;
  token_type?: string;
};

export type TikTokUserInfoResponse = {
  open_id: string;
  union_id: string;
  avatar_url: string;
  display_name: string;
  bio_description?: string;
  profile_deep_link?: string;
  is_verified?: boolean;
};

/**
 * Generates the TikTok OAuth authorization URL
 */
export function generateTikTokAuthUrl(state?: string): {
  url: string;
  state: string;
} {
  // Create a random state if not provided
  const csrfState = state ?? nanoid();

  const queryParams = new URLSearchParams({
    client_key: TIKTOK_API_CONFIG.CLIENT_KEY,
    response_type: "code",
    scope: TIKTOK_API_CONFIG.SCOPES.join(","),
    redirect_uri: TIKTOK_API_CONFIG.REDIRECT_URI,
    state: csrfState,
  });

  return {
    url: `${TIKTOK_API_CONFIG.AUTH_URL}?${queryParams.toString()}`,
    state: csrfState,
  };
}
/**
 * Exchange authorization code for access token
 */
export async function exchangeTikTokCode(
  code: string
): Promise<TikTokTokenResponse> {
  try {
    const response = await axios.post(TIKTOK_API_CONFIG.TOKEN_URL, {
      client_key: TIKTOK_API_CONFIG.CLIENT_KEY,
      client_secret: TIKTOK_API_CONFIG.CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: TIKTOK_API_CONFIG.REDIRECT_URI,
    });

    if (response.data.message !== "success") {
      throw new Error(`TikTok token exchange failed: ${response.data.message}`);
    }

    return response.data.data as TikTokTokenResponse;
  } catch (error) {
    console.error("Error exchanging TikTok code for token:", error);
    throw error;
  }
}

/**
 * Get TikTok user information using access token
 */
export async function getTikTokUserInfo(
  accessToken: string
): Promise<TikTokUserInfoResponse> {
  try {
    const response = await axios.get(TIKTOK_API_CONFIG.USER_INFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.data.message !== "success") {
      throw new Error(
        `Failed to get TikTok user info: ${response.data.message}`
      );
    }

    return response.data.data.user as TikTokUserInfoResponse;
  } catch (error) {
    console.error("Error fetching TikTok user info:", error);
    throw error;
  }
}

/**
 * Refresh TikTok access token
 */
export async function refreshTikTokToken(
  refreshToken: string
): Promise<TikTokTokenResponse> {
  try {
    const response = await axios.post(TIKTOK_API_CONFIG.REFRESH_TOKEN_URL, {
      client_key: TIKTOK_API_CONFIG.CLIENT_KEY,
      client_secret: TIKTOK_API_CONFIG.CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    if (response.data.message !== "success") {
      throw new Error(`TikTok token refresh failed: ${response.data.message}`);
    }

    return response.data.data as TikTokTokenResponse;
  } catch (error) {
    console.error("Error refreshing TikTok token:", error);
    throw error;
  }
}
