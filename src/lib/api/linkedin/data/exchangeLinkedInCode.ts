// lib/api/linkedin/exchangeLinkedInCode.ts
import { TokenExchangeResponse } from "@/lib/types/TokenExchangeResponse";

export async function exchangeLinkedInCode(
  code: string
): Promise<TokenExchangeResponse> {
  // Get configuration from environment variables
  const client_id = process.env.NEXT_PUBLIC_LINKEDIN_CLIENT_ID;
  const client_secret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirect_uri = process.env.NEXT_PUBLIC_LINKEDIN_REDIRECT_URL;

  if (!client_id || !client_secret || !redirect_uri) {
    throw new Error(
      "LinkedIn configuration missing. Check environment variables."
    );
  }

  // LinkedIn API endpoint for token exchange
  const url = "https://www.linkedin.com/oauth/v2/accessToken";

  try {
    console.log("[LinkedIn] Exchanging code for tokens...");

    // Build form parameters exactly as LinkedIn expects
    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", redirect_uri);
    params.append("client_id", client_id);
    params.append("client_secret", client_secret);

    console.log("[LinkedIn] Request params:", params.toString());

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
    console.log("[LinkedIn] Token response:", responseText);

    if (!response.ok) {
      throw new Error(
        `LinkedIn code exchange failed (${response.status}): ${responseText}`
      );
    }

    // Parse response as JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      throw new Error(
        `Failed to parse LinkedIn token response: ${responseText}+${parseError}`
      );
    }

    // Check for valid response
    if (!data || data.error) {
      throw new Error(
        `Invalid LinkedIn token response: ${JSON.stringify(data)}`
      );
    }

    if (!data.access_token) {
      throw new Error(
        `Missing required fields in LinkedIn token response: ${JSON.stringify(
          data
        )}`
      );
    }

    return data as TokenExchangeResponse;
  } catch (error) {
    console.error("Error exchanging LinkedIn code:", error);
    throw error;
  }
}
