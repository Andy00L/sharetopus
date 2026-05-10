// lib/api/linkedin/exchangeLinkedInCode.ts
import "server-only";

import {
  TokenExchangeResponse,
  TokenExchangeResult,
} from "@/lib/types/dbTypes";

export async function exchangeLinkedInCode(
  code: string
): Promise<TokenExchangeResult> {
  // Get configuration from environment variables
  const client_id = process.env.LINKEDIN_CLIENT_ID;
  const client_secret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirect_uri = process.env.LINKEDIN_REDIRECT_URL;

  if (!client_id || !client_secret || !redirect_uri) {
    console.error("[exchangeLinkedInCode] LinkedIn configuration missing");
    return {
      success: false,
      message: "LinkedIn configuration missing. Check environment variables.",
    };
  }

  // LinkedIn API endpoint for token exchange
  const url = "https://www.linkedin.com/oauth/v2/accessToken";

  try {
    console.log("[exchangeLinkedInCode] Exchanging code for tokens...");

    // Build form parameters exactly as LinkedIn expects
    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", redirect_uri);
    params.append("client_id", client_id);
    params.append("client_secret", client_secret);

    console.log("[exchangeLinkedInCode] Request params:", params.toString());

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
    console.log("[exchangeLinkedInCode] Token response:", responseText);

    if (!response.ok) {
      console.error(
        `[exchangeLinkedInCode] HTTP ${response.status}: ${responseText}`
      );
      return {
        success: false,
        message: `LinkedIn code exchange failed (${response.status})`,
      };
    }

    // Parse response as JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error(
        "[exchangeLinkedInCode] Failed to parse token response:",
        parseError
      );
      return {
        success: false,
        message: "Failed to parse LinkedIn token response",
      };
    }

    // Check for valid response
    if (!data || data.error) {
      console.error(
        "[exchangeLinkedInCode] Invalid token response:",
        JSON.stringify(data)
      );
      return {
        success: false,
        message: "Invalid LinkedIn token response",
      };
    }

    if (!data.access_token) {
      console.error(
        "[exchangeLinkedInCode] Missing access_token in response:",
        JSON.stringify(data)
      );
      return {
        success: false,
        message: "Missing access_token in LinkedIn token response",
      };
    }

    return { success: true, data: data as TokenExchangeResponse };
  } catch (error) {
    console.error("[exchangeLinkedInCode] Unexpected error:", error);
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Unexpected error during LinkedIn code exchange",
    };
  }
}
