// lib/api/instagram/data/refreshInstagramToken.ts
import { TokenExchangeResponse } from "@/lib/types/dbTypes";
import "server-only";

/**
 * Refreshes an Instagram long-lived access token
 * Instagram API with Instagram Login uses token refresh instead of refresh tokens
 * Long-lived tokens can be refreshed to extend their expiration date by 60 days
 */
export default async function refreshInstagramToken(
  currentAccessToken: string
): Promise<TokenExchangeResponse | null> {
  // Note: Instagram API with Instagram Login doesn't use refresh_token parameter
  // Instead, we refresh the current access_token to extend its life

  try {
    console.log(
      "[Instagram Refresh Token] Attempting to refresh Instagram token"
    );

    // Instagram Graph API endpoint for refreshing long-lived tokens
    const url = "https://graph.instagram.com/refresh_access_token";

    // Build query parameters for Instagram token refresh
    const params = new URLSearchParams();
    params.append("grant_type", "ig_refresh_token");
    params.append("access_token", currentAccessToken);

    // Make the refresh request
    const response = await fetch(`${url}?${params.toString()}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const responseText = await response.text();
    console.log("[Instagram Refresh Token] Response:", responseText);

    if (!response.ok) {
      console.error(
        `[Instagram Refresh Token] Refresh failed (${response.status}): ${responseText}`
      );

      // Parse error response to get more details
      try {
        const errorData = JSON.parse(responseText);
        if (errorData.error) {
          console.error(
            `[Instagram Refresh Token] API Error: ${errorData.error.code} - ${errorData.error.message}`
          );

          // Check for specific error codes
          if (errorData.error.code === 190) {
            // Invalid access token - cannot refresh
            console.error(
              "[Instagram Refresh Token] Token is invalid and cannot be refreshed"
            );
            return null;
          }

          if (errorData.error.code === 10) {
            // Application does not have permission
            console.error(
              "[Instagram Refresh Token] Application lacks permission to refresh token"
            );
            return null;
          }
        }
      } catch (parseError) {
        console.error(
          "[Instagram Refresh Token] Could not parse error response:",
          parseError
        );
      }

      return null;
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error(
        "[Instagram Refresh Token] Failed to parse refresh response:",
        parseError
      );
      return null;
    }

    // Check for API errors in the response
    if (data.error) {
      console.error(
        `[Instagram Refresh Token] Instagram API error: ${JSON.stringify(
          data.error
        )}`
      );
      return null;
    }

    // Validate that we received the required fields
    if (!data.access_token) {
      console.error(
        `[Instagram Refresh Token] Missing access_token in response: ${JSON.stringify(
          data
        )}`
      );
      return null;
    }

    console.log("[Instagram Refresh Token] Token refreshed successfully");

    // Instagram refresh returns a new access token with extended expiration
    // Default expiration is 60 days from now
    return {
      access_token: data.access_token,
      refresh_token: "null", // Instagram API with Instagram Login doesn't use refresh tokens
      expires_in: data.expires_in || 5184000, // 60 days default
      token_type: data.token_type || "bearer",
    } as TokenExchangeResponse;
  } catch (error) {
    console.error("[Instagram Refresh Token] Unexpected error:", error);
    return null;
  }
}

/**
 * Check if an Instagram token needs to be refreshed
 * Instagram tokens should be refreshed when they have less than 24 hours remaining
 * @param expiresAt The expiration date of the current token
 * @returns true if the token should be refreshed
 */
export function shouldRefreshInstagramToken(expiresAt: string | null): boolean {
  if (!expiresAt) {
    console.log(
      "[Instagram Token Check] No expiry date found - should refresh"
    );
    return true;
  }

  try {
    const now = new Date();
    const expiry = new Date(expiresAt);

    // Refresh if token expires within 24 hours (Instagram best practice)
    const refreshThreshold = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    const shouldRefresh = now.getTime() + refreshThreshold >= expiry.getTime();

    console.log(
      `[Instagram Token Check] Token expires at: ${expiry.toISOString()}, Current time: ${now.toISOString()}, Should refresh: ${shouldRefresh}`
    );

    return shouldRefresh;
  } catch (error) {
    console.error("[Instagram Token Check] Error parsing expiry date:", error);
    return true; // Treat parsing errors as expired for safety
  }
}
