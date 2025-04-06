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
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET; // This must be stored securely on the server
  const redirectUri = process.env.NEXT_PUBLIC_TIKTOK_REDIRECT_URL;

  if (!clientKey || !clientSecret || !redirectUri) {
    throw new Error("TikTok configuration missing.");
  }

  // TikTok requires a specific format for the token exchange
  // Note: TikTok expects a POST request with specific parameters
  const url = "https://open.tiktokapis.com/v2/oauth/token/";

  try {
    const formData = new URLSearchParams();
    formData.append("client_key", clientKey);
    formData.append("client_secret", clientSecret);
    formData.append("code", code);
    formData.append("grant_type", "authorization_code");
    formData.append("redirect_uri", redirectUri);

    console.log("Sending token exchange request to TikTok:", {
      url,
      clientKey,
      code: code.substring(0, 10) + "...", // Log partial code for debugging
      redirectUri,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    // Log the raw response for debugging
    const responseText = await response.text();
    console.log("Token exchange raw response:", responseText);

    // Parse the response if possible
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      throw new Error(
        `Failed to parse TikTok response: ${responseText} + ${e}`
      );
    }

    if (!response.ok) {
      throw new Error(`TikTok token exchange failed: ${JSON.stringify(data)}`);
    }

    // Handle successful response
    if (data.access_token) {
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token || "",
        expires_in: data.expires_in || 86400, // Default to 24 hours if not provided
        open_id: data.open_id,
        scope: data.scope,
      };
    } else {
      throw new Error(`Invalid TikTok response: ${JSON.stringify(data)}`);
    }
  } catch (error) {
    console.error("Error exchanging TikTok code:", error);
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
