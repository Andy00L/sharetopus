import {
  TokenExchangeResponse,
  TokenExchangeResult,
} from "@/lib/types/dbTypes";
import "server-only";

// lib/api/tiktok/auth.ts
export async function exchangeTikTokCode(
  code: string
): Promise<TokenExchangeResult> {
  // Get configuration from environment variables
  const client_id =
    process.env.NODE_ENV === "development"
      ? process.env.TIKTOK_CLIENT_KEY_DEV
      : process.env.TIKTOK_CLIENT_KEY;

  const client_secret =
    process.env.NODE_ENV === "development"
      ? process.env.TIKTOK_CLIENT_SECRET_DEV
      : process.env.TIKTOK_CLIENT_SECRET;

  const redirect_uri = process.env.TIKTOK_REDIRECT_URL;

  if (!client_id || !client_secret || !redirect_uri) {
    console.error("[exchangeTikTokCode] TikTok configuration missing");
    return {
      success: false,
      message: "TikTok configuration missing. Check environment variables.",
    };
  }

  // TikTok API endpoint for token exchange (V2)
  const url = "https://open.tiktokapis.com/v2/oauth/token/";

  // Build form parameters
  const params = new URLSearchParams();
  params.append("client_key", client_id);
  params.append("client_secret", client_secret);
  params.append("code", code);
  params.append("grant_type", "authorization_code");
  params.append("redirect_uri", redirect_uri);

  try {
    console.log("[exchangeTikTokCode] Exchanging code for tokens...");

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
    console.log("[exchangeTikTokCode] Token response:", responseText);

    if (!response.ok) {
      console.error(
        `[exchangeTikTokCode] HTTP ${response.status}: ${responseText}`
      );
      return {
        success: false,
        message: `TikTok code exchange failed (${response.status})`,
      };
    }

    // Parse response as JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error(
        "[exchangeTikTokCode] Failed to parse token response:",
        parseError
      );
      return {
        success: false,
        message: "Failed to parse TikTok token response",
      };
    }

    // Validate response contains required fields
    if (!data || data.error) {
      console.error(
        "[exchangeTikTokCode] Invalid token response:",
        JSON.stringify(data)
      );
      return {
        success: false,
        message: "Invalid TikTok token response",
      };
    }

    if (!data.access_token || !data.open_id) {
      console.error(
        "[exchangeTikTokCode] Missing required fields in response:",
        JSON.stringify(data)
      );
      return {
        success: false,
        message: "Missing required fields in TikTok token response",
      };
    }

    return { success: true, data: data as TokenExchangeResponse };
  } catch (error) {
    console.error("[exchangeTikTokCode] Unexpected error:", error);
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Unexpected error during TikTok code exchange",
    };
  }
}
