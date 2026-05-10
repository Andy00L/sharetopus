// lib/api/pinterest/exchangePinterestCode.ts
import "server-only";

import {
  TokenExchangeResponse,
  TokenExchangeResult,
} from "@/lib/types/dbTypes";

export async function exchangePinterestCode(
  code: string
): Promise<TokenExchangeResult> {
  // Get configuration from environment variables
  const client_id = process.env.PINTEREST_CLIENT_ID;
  const client_secret = process.env.PINTEREST_CLIENT_SECRET;
  const redirect_uri = process.env.PINTEREST_REDIRECT_URL;

  if (!client_id || !client_secret || !redirect_uri) {
    console.error("[exchangePinterestCode] Pinterest configuration missing");
    return {
      success: false,
      message: "Pinterest configuration missing. Check environment variables.",
    };
  }

  // Pinterest API endpoint for token exchange
  const url = "https://api.pinterest.com/v5/oauth/token";

  try {
    console.log("[exchangePinterestCode] Exchanging code for tokens...");

    // Create Basic Auth token from client_id and client_secret
    const basicAuth = Buffer.from(`${client_id}:${client_secret}`).toString(
      "base64"
    );

    // Build form parameters exactly as Pinterest expects
    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", redirect_uri);

    console.log("[exchangePinterestCode] Request params:", params.toString());

    // Make token exchange request
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: params.toString(),
    });

    // Get raw response text for error handling
    const responseText = await response.text();
    console.log("[exchangePinterestCode] Token response:", responseText);

    if (!response.ok) {
      console.error(
        `[exchangePinterestCode] HTTP ${response.status}: ${responseText}`
      );
      return {
        success: false,
        message: `Pinterest code exchange failed (${response.status})`,
      };
    }

    // Parse response as JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error(
        "[exchangePinterestCode] Failed to parse token response:",
        parseError
      );
      return {
        success: false,
        message: "Failed to parse Pinterest token response",
      };
    }

    // Check for valid response
    if (!data || data.error) {
      console.error(
        "[exchangePinterestCode] Invalid token response:",
        JSON.stringify(data)
      );
      return {
        success: false,
        message: "Invalid Pinterest token response",
      };
    }

    if (!data.access_token) {
      console.error(
        "[exchangePinterestCode] Missing access_token in response:",
        JSON.stringify(data)
      );
      return {
        success: false,
        message: "Missing access_token in Pinterest token response",
      };
    }

    return { success: true, data: data as TokenExchangeResponse };
  } catch (error) {
    console.error("[exchangePinterestCode] Unexpected error:", error);
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Unexpected error during Pinterest code exchange",
    };
  }
}
