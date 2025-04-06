// lib/api/tiktok/auth.ts
export interface TokenExchangeResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  open_id: string;
  scope?: string;
}

/**
 * Exchanges an authorization code for access tokens
 *
 * @param code Authorization code from TikTok
 * @returns TokenExchangeResponse with access token, refresh token, etc.
 */
export async function exchangeTikTokCode(
  code: string
): Promise<TokenExchangeResponse> {
  // Get configuration from environment variables
  const clientKey = process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri = process.env.NEXT_PUBLIC_TIKTOK_REDIRECT_URL;

  if (!clientKey || !clientSecret || !redirectUri) {
    throw new Error("TikTok configuration missing.");
  }

  // TikTok requires a specific format for the token exchange
  const url = "https://open.tiktokapis.com/v2/oauth/token/";

  try {
    console.log("[TikTok Auth] Sending token exchange request...");

    // Create form data according to TikTok API requirements
    const formData = new URLSearchParams();
    formData.append("client_key", clientKey);
    formData.append("client_secret", clientSecret);
    formData.append("code", code);
    formData.append("grant_type", "authorization_code");
    formData.append("redirect_uri", redirectUri);

    // Make the request
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    // Log the raw response for debugging
    const responseText = await response.text();
    console.log("[TikTok Auth] Token exchange raw response:", responseText);

    // Parse the response
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Failed to parse TikTok response: ${responseText}+ ${e}`);
    }

    if (!response.ok || data.error) {
      throw new Error(`TikTok token exchange failed: ${JSON.stringify(data)}`);
    }

    // Extract token data from response
    const tokenData = data.data || data;

    return {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || "",
      expires_in: tokenData.expires_in || 86400, // Default to 24 hours if not provided
      open_id: tokenData.open_id,
      scope: tokenData.scope,
    };
  } catch (error) {
    console.error("[TikTok Auth] Error exchanging code:", error);
    throw error;
  }
}

/**
 * Refreshes a TikTok access token
 *
 * @param refreshToken Valid refresh token
 * @returns New token response
 */
export async function refreshTikTokToken(
  refreshToken: string
): Promise<TokenExchangeResponse> {
  const clientKey = process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    throw new Error("TikTok configuration missing.");
  }

  const url = "https://open.tiktokapis.com/v2/oauth/token/";

  try {
    const formData = new URLSearchParams();
    formData.append("client_key", clientKey);
    formData.append("client_secret", clientSecret);
    formData.append("grant_type", "refresh_token");
    formData.append("refresh_token", refreshToken);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`TikTok token refresh failed: ${errorText}`);
    }

    const data = await response.json();
    const tokenData = data.data || data;

    return {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || refreshToken,
      expires_in: tokenData.expires_in || 86400,
      open_id: tokenData.open_id,
      scope: tokenData.scope,
    };
  } catch (error) {
    console.error("[TikTok Auth] Error refreshing token:", error);
    throw error;
  }
}

/**
 * Generates the TikTok OAuth authorization URL
 *
 * @param state Optional state parameter for CSRF protection
 * @returns Object containing the authorization URL and state
 */
export function generateTikTokAuthUrl(state?: string): {
  url: string;
  state: string;
} {
  // Get configuration from environment variables
  const clientKey = process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY;
  const redirectUri = process.env.NEXT_PUBLIC_TIKTOK_REDIRECT_URL;

  if (!clientKey || !redirectUri) {
    throw new Error("TikTok configuration missing");
  }

  // Create a random state if not provided
  const csrfState = state ?? generateRandomState();

  // Define the required scopes
  const scopes = ["user.info.basic", "video.upload", "video.publish"];

  // Build the authorization URL
  const queryParams = new URLSearchParams({
    client_key: clientKey,
    response_type: "code",
    scope: scopes.join(","),
    redirect_uri: redirectUri,
    state: csrfState,
  });

  return {
    url: `https://www.tiktok.com/v2/auth/authorize?${queryParams.toString()}`,
    state: csrfState,
  };
}

/**
 * Generates a random state string for CSRF protection
 */
function generateRandomState(): string {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}
