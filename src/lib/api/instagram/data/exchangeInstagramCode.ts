// lib/api/instagram/data/exchangeInstagramCode.ts
import { TokenExchangeResponse } from "@/lib/types/dbTypes";
import "server-only";

export async function exchangeInstagramCode(
  code: string
): Promise<TokenExchangeResponse> {
  // Get configuration from environment variables
  const client_id = process.env.INSTAGRAM_CLIENT_ID;
  const client_secret = process.env.INSTAGRAM_CLIENT_SECRET;
  const redirect_uri = process.env.INSTAGRAM_REDIRECT_URL;

  if (!client_id || !client_secret || !redirect_uri) {
    throw new Error(
      "Instagram configuration missing. Check environment variables."
    );
  }

  // Instagram API endpoint for token exchange
  const url = "https://api.instagram.com/oauth/access_token";

  // Build form parameters for Instagram OAuth
  const params = new URLSearchParams();
  params.append("client_id", client_id);
  params.append("client_secret", client_secret);
  params.append("grant_type", "authorization_code");
  params.append("redirect_uri", redirect_uri);
  params.append("code", code);

  try {
    console.log("[Instagram] Exchanging code for tokens...");

    // Make token exchange request
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    // Get raw response text for error handling
    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `Instagram code exchange failed (${response.status}): ${responseText}`
      );
    }

    // Parse response as JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      throw new Error(
        `Failed to parse Instagram token response: ${responseText} + ${parseError}`
      );
    }

    // Check for Instagram API errors
    if (data.error_type || data.error_message) {
      throw new Error(
        `Instagram API error: ${data.error_type} - ${data.error_message}`
      );
    }

    // Instagram API returns data in a nested format: { data: [{ access_token, user_id, permissions }] }
    const tokenData = data.data && data.data[0] ? data.data[0] : data;

    // Validate response contains required fields
    if (!tokenData.access_token || !tokenData.user_id) {
      throw new Error(
        `Missing required fields in Instagram token response: ${JSON.stringify(
          data
        )}`
      );
    }

    // Instagram API with Instagram Login returns a short-lived token
    // We need to exchange it for a long-lived token (60 days)
    const longLivedTokenData = await exchangeForLongLivedToken(
      tokenData.access_token
    );

    return {
      access_token: longLivedTokenData.access_token,
      refresh_token: "null", // Instagram API with Instagram Login doesn't provide refresh tokens
      expires_in: longLivedTokenData.expires_in || 5184000, // 60 days default
      user_id: tokenData.user_id,
      scope:
        tokenData.permissions ||
        "instagram_business_basic,instagram_business_content_publish", // Use actual permissions from response
    } as TokenExchangeResponse;
  } catch (error) {
    console.error("Error exchanging Instagram code:", error);
    throw error;
  }
}

/**
 * Exchange short-lived token for long-lived token (60 days)
 * Instagram API with Instagram Login provides short-lived tokens that need to be exchanged
 */
async function exchangeForLongLivedToken(
  shortLivedToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const client_secret = process.env.INSTAGRAM_CLIENT_SECRET;

  if (!client_secret) {
    throw new Error("Instagram client secret is required for long-lived token");
  }

  const url = "https://graph.instagram.com/access_token";

  const params = new URLSearchParams();
  params.append("grant_type", "ig_exchange_token");
  params.append("client_secret", client_secret);
  params.append("access_token", shortLivedToken);

  try {
    console.log("[Instagram] Exchanging for long-lived token...");

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const responseText = await response.text();
    console.log("[Instagram] Long-lived token response:", responseText);

    if (!response.ok) {
      // If long-lived token exchange fails, return the short-lived token
      console.warn(
        `[Instagram] Long-lived token exchange failed (${response.status}): ${responseText}`
      );
      console.warn("[Instagram] Falling back to short-lived token");
      return {
        access_token: shortLivedToken,
        expires_in: 3600, // 1 hour for short-lived token
      };
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.warn(
        `[Instagram] Failed to parse long-lived token response: ${responseText}`,
        parseError
      );
      // Fallback to short-lived token
      return {
        access_token: shortLivedToken,
        expires_in: 3600,
      };
    }

    if (data.error || !data.access_token) {
      console.warn(
        `[Instagram] Long-lived token error: ${JSON.stringify(data)}`
      );
      // Fallback to short-lived token
      return {
        access_token: shortLivedToken,
        expires_in: 3600,
      };
    }

    console.log("[Instagram] Successfully obtained long-lived token");
    return {
      access_token: data.access_token,
      expires_in: data.expires_in || 5184000, // 60 days
    };
  } catch (error) {
    console.error("[Instagram] Error exchanging for long-lived token:", error);
    // Fallback to short-lived token
    return {
      access_token: shortLivedToken,
      expires_in: 3600,
    };
  }
}
