// lib/api/instagram/data/exchangeInstagramCode.ts
import { TokenExchangeResponse } from "@/lib/types/dbTypes";
import "server-only";

export interface InstagramTokenExchangeResult {
  success: boolean;
  message: string;
  data?: TokenExchangeResponse;
}

export async function exchangeInstagramCode(
  code: string
): Promise<InstagramTokenExchangeResult> {
  try {
    // Get configuration from environment variables
    const client_id = process.env.INSTAGRAM_CLIENT_ID;
    const client_secret = process.env.INSTAGRAM_CLIENT_SECRET;
    const redirect_uri = process.env.INSTAGRAM_REDIRECT_URL;

    if (!client_id || !client_secret || !redirect_uri) {
      console.error("[Instagram] Missing environment variables:", {
        client_id: !!client_id,
        client_secret: !!client_secret,
        redirect_uri: !!redirect_uri,
      });
      return {
        success: false,
        message:
          "Instagram configuration is incomplete. Please try again or contact support.",
      };
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
      console.error("[Instagram] Token exchange failed:", {
        status: response.status,
        statusText: response.statusText,
        response: responseText,
      });
      return {
        success: false,
        message: `Failed to connect your Instagram account. Please try again or contact support if the problem persists.`,
      };
    }

    // Parse response as JSON

    const data = JSON.parse(responseText);

    // Check for Instagram API errors
    if (data.error_type || data.error_message) {
      console.error("[Instagram] API returned error:", {
        error_type: data.error_type,
        error_message: data.error_message,
        full_response: data,
      });
      return {
        success: false,
        message: `Instagram authentication failed: ${data.error_message}. Please try again.`,
      };
    }

    // Instagram API returns data in a nested format: { data: [{ access_token, user_id, permissions }] }
    const tokenData = data.data?.[0] ?? data;

    // Validate response contains required fields
    if (!tokenData.access_token || !tokenData.user_id) {
      console.error("[Instagram] Missing required fields in response:", {
        has_access_token: !!tokenData.access_token,
        has_user_id: !!tokenData.user_id,
        received_data: data,
      });
      return {
        success: false,
        message:
          "Instagram didn't provide the required authentication information. Please try connecting again.",
      };
    }

    // Instagram API with Instagram Login returns a short-lived token
    // We need to exchange it for a long-lived token (60 days)
    const longLivedTokenData = await exchangeForLongLivedToken(
      tokenData.access_token
    );

    if (!longLivedTokenData.success || !longLivedTokenData.data) {
      console.error(
        "[Instagram] Error while exchanging the short-lived token:",
        longLivedTokenData.message
      );
      return {
        success: false,
        message: longLivedTokenData.message,
      };
    }

    const tokenResponse: TokenExchangeResponse = {
      access_token: longLivedTokenData.data.access_token,
      refresh_token: "null", // Instagram API with Instagram Login doesn't provide refresh tokens
      expires_in: longLivedTokenData.data.expires_in, // 60 days default
      user_id: tokenData.user_id,
      scope: tokenData.permissions,
      token_type: "bearer",
    };

    return {
      success: true,
      message: "Instagram account connected successfully.",
      data: tokenResponse,
    };
  } catch (error) {
    console.error("[Instagram] Unexpected error during token exchange:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return {
      success: false,
      message:
        "An unexpected error occurred while connecting your Instagram account. Please try again.",
    };
  }
}

/**
 * Exchange short-lived token for long-lived token (60 days)
 * Instagram API with Instagram Login provides short-lived tokens that need to be exchanged
 */
async function exchangeForLongLivedToken(
  shortLivedToken: string
): Promise<InstagramTokenExchangeResult> {
  try {
    const client_secret = process.env.INSTAGRAM_CLIENT_SECRET;

    if (!client_secret) {
      console.error(
        "[Instagram] Missing client secret for long-lived token exchange"
      );
      return {
        success: false,
        message:
          "Instagram configuration is incomplete for token upgrade. Using temporary token.",
      };
    }

    const url = "https://graph.instagram.com/access_token";

    const params = new URLSearchParams();
    params.append("grant_type", "ig_exchange_token");
    params.append("client_secret", client_secret);
    params.append("access_token", shortLivedToken);

    console.log("[Instagram] Exchanging for long-lived token...");

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const responseText = await response.text();

    if (!response.ok) {
      // If long-lived token exchange fails, return the short-lived token
      console.error("[Instagram] Long-lived token exchange failed:", {
        status: response.status,
        statusText: response.statusText,
        response: responseText,
      });
      return {
        success: false,
        message: "Instagram token upgrade failed. Please try connecting again.",
      };
    }

    const data = JSON.parse(responseText);

    if (data.error || !data.access_token) {
      console.error("[Instagram] Long-lived token API error:", {
        error: data.error,
        has_access_token: !!data.access_token,
        full_response: data,
      });
      return {
        success: false,
        message: "Instagram token upgrade failed. Please try connecting again.",
      };
    }

    console.log("[Instagram] Successfully obtained long-lived token");

    return {
      success: true,
      message: "Instagram account connected with extended access.",
      data: {
        access_token: data.access_token,
        expires_in: data.expires_in, // 60 days
      },
    };
  } catch (error) {
    console.error(
      "[Instagram] Unexpected error during long-lived token exchange:",
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }
    );

    // Fallback to short-lived token
    return {
      success: false,
      message:
        "Instagram configuration is incomplete. Please try again or contact support if the problem persists.",
    };
  }
}
