// lib/api/pinterest/exchangePinterestCode.ts
import { TokenExchangeResponse } from "@/lib/types/TokenExchangeResponse";

export async function exchangePinterestCode(
  code: string
): Promise<TokenExchangeResponse> {
  // Get configuration from environment variables
  const client_id = process.env.NEXT_PUBLIC_PINTEREST_CLIENT_ID;
  const client_secret = process.env.PINTEREST_CLIENT_SECRET;
  const redirect_uri = process.env.NEXT_PUBLIC_PINTEREST_REDIRECT_URL;

  if (!client_id || !client_secret || !redirect_uri) {
    throw new Error(
      "Pinterest configuration missing. Check environment variables."
    );
  }

  // Pinterest API endpoint for token exchange
  const url = "https://api.pinterest.com/v5/oauth/token";

  // Build form parameters
  const params = new URLSearchParams();
  params.append("client_id", client_id);
  params.append("client_secret", client_secret);
  params.append("code", code);
  params.append("grant_type", "authorization_code");
  params.append("redirect_uri", redirect_uri);

  try {
    console.log("[Pinterest] Exchanging code for tokens...");

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
    console.log("[Pinterest] Token response:", responseText);

    if (!response.ok) {
      throw new Error(
        `Pinterest code exchange failed (${response.status}): ${responseText}`
      );
    }

    // Parse response as JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      throw new Error(
        `Failed to parse Pinterest token response: ${responseText}+${parseError}`
      );
    }

    // Validate response contains required fields
    if (!data || data.error) {
      throw new Error(
        `Invalid Pinterest token response: ${JSON.stringify(data)}`
      );
    }

    if (!data.access_token) {
      throw new Error(
        `Missing required fields in Pinterest token response: ${JSON.stringify(
          data
        )}`
      );
    }

    return data as TokenExchangeResponse;
  } catch (error) {
    console.error("Error exchanging Pinterest code:", error);
    throw error;
  }
}
