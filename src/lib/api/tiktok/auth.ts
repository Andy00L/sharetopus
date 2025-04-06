import { TokenExchangeResponse } from "@/actions/types/TokenExchangeResponse";

// lib/api/tiktok/auth.ts
export async function exchangeTikTokCode(
  code: string
): Promise<TokenExchangeResponse> {
  // Get configuration from environment variables
  const client_id = process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY;
  const client_secret = process.env.TIKTOK_CLIENT_SECRET;
  const redirect_uri = process.env.NEXT_PUBLIC_TIKTOK_REDIRECT_URL;

  if (!client_id || !client_secret || !redirect_uri) {
    throw new Error(
      "TikTok configuration missing. Check environment variables."
    );
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
    console.log("[TikTok] Exchanging code for tokens...");

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
    console.log("[TikTok] Token response:", responseText);

    if (!response.ok) {
      throw new Error(
        `TikTok code exchange failed (${response.status}): ${responseText}`
      );
    }

    // Parse response as JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      throw new Error(
        `Failed to parse TikTok token response: ${responseText}+${parseError}`
      );
    }

    // Validate response contains required fields
    if (!data || data.error) {
      throw new Error(`Invalid TikTok token response: ${JSON.stringify(data)}`);
    }

    if (!data.access_token || !data.open_id) {
      throw new Error(
        `Missing required fields in TikTok token response: ${JSON.stringify(
          data
        )}`
      );
    }

    return data as TokenExchangeResponse;
  } catch (error) {
    console.error("Error exchanging TikTok code:", error);
    throw error;
  }
}
