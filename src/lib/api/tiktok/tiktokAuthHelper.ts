// src/lib/tiktokAuthHelper.ts
import { adminSupabase } from "@/actions/api/supabase";
import { TokenExchangeResponse } from "@/lib/types/TokenExchangeResponse"; // Use your shared type

// Function to call TikTok's token endpoint for refreshing
async function refreshTikTokTokenApi(
  refreshToken: string
): Promise<TokenExchangeResponse> {
  const clientId = process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("TikTok client credentials missing for refresh.");
  }

  const url = "https://open.tiktokapis.com/v2/oauth/token/";
  const params = new URLSearchParams();
  params.append("client_key", clientId);
  params.append("client_secret", clientSecret);
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", refreshToken);

  try {
    console.log("[TikTok Refresh] Requesting new token...");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data: TokenExchangeResponse = await response.json();

    if (!response.ok || data.error) {
      console.error(
        "[TikTok Refresh] Failed:",
        data.error,
        data.error_description
      );
      // Throw specific error if refresh token is invalid/expired
      if (data.error === "invalid_grant") {
        throw new Error("TikTok refresh token is invalid or expired.");
      }
      throw new Error(
        `TikTok token refresh failed (${response.status}): ${
          data.error_description || data.error || "Unknown error"
        }`
      );
    }

    console.log("[TikTok Refresh] Success.");
    // Ensure essential fields are present
    if (!data.access_token || !data.refresh_token || !data.expires_in) {
      throw new Error("Incomplete token data received from TikTok refresh.");
    }
    return data;
  } catch (error) {
    console.error("[TikTok Refresh] Network/fetch error:", error);
    throw error; // Re-throw the error
  }
}

// Main helper function to get a valid token
export async function getValidTikTokToken(
  userId: string,
  accountId: string // The database ID of the social_accounts row
): Promise<string> {
  console.log(
    `[TikTok Token] Getting token for user ${userId}, account ${accountId}`
  );
  const { data: accountData, error: fetchError } = await adminSupabase
    .from("social_accounts")
    .select("id, access_token, refresh_token, token_expires_at")
    .eq("user_id", userId)
    .eq("id", accountId)
    .eq("platform", "tiktok")
    .maybeSingle(); // Use maybeSingle to handle not found gracefully

  if (fetchError) {
    console.error("[TikTok Token] Error fetching account:", fetchError);
    throw new Error("Failed to fetch TikTok account details.");
  }
  if (!accountData) {
    console.error(`[TikTok Token] Account not found: ${accountId}`);
    throw new Error("TikTok account not found or doesn't belong to user.");
  }

  const { access_token, refresh_token, token_expires_at } = accountData;
  const now = new Date();
  // Refresh if expiry is missing, null, or within the next 5 minutes (300 seconds)
  const expiryDate = token_expires_at ? new Date(token_expires_at) : null;
  const shouldRefresh =
    !expiryDate || expiryDate.getTime() < now.getTime() + 300 * 1000;

  if (shouldRefresh) {
    console.log("[TikTok Token] Token needs refresh.");
    if (!refresh_token) {
      console.error(
        "[TikTok Token] Missing refresh token for expired access token."
      );
      throw new Error("Cannot refresh TikTok token: Refresh token missing.");
    }

    try {
      const refreshedData = await refreshTikTokTokenApi(refresh_token);

      // Calculate new expiry date
      const newExpiry = new Date(
        Date.now() + refreshedData.expires_in * 1000
      ).toISOString();

      // Update the database with the NEW tokens and expiry
      const { error: updateError } = await adminSupabase
        .from("social_accounts")
        .update({
          access_token: refreshedData.access_token,
          refresh_token: refreshedData.refresh_token, // TikTok provides a new refresh token
          token_expires_at: newExpiry,
          updated_at: new Date().toISOString(), // Update timestamp
        })
        .eq("id", accountId);

      if (updateError) {
        console.error(
          "[TikTok Token] Failed to update tokens in DB:",
          updateError
        );
        // Log error but proceed with the new token for this request
      } else {
        console.log("[TikTok Token] Tokens updated in DB.");
      }

      return refreshedData.access_token; // Return the NEW access token
    } catch (refreshError) {
      console.error("[TikTok Token] Refresh process failed:", refreshError);
      // If refresh fails (e.g., invalid refresh token), we might need to mark the account as needing re-auth
      // For now, just throw the error
      throw refreshError;
    }
  } else {
    console.log("[TikTok Token] Existing token is valid.");
    return access_token; // Return the existing valid access token
  }
}
