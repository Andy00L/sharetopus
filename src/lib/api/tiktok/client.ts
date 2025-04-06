// lib/api/tiktok/client.ts
export interface TikTokProfile {
  id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  is_verified?: boolean;
  follower_count?: number;
  following_count?: number;
  bio_description?: string;
}

/**
 * Fetches TikTok user profile using the provided access token
 *
 * @param accessToken Valid TikTok access token
 * @returns TikTok profile information
 */
export async function getTikTokProfile(
  accessToken: string
): Promise<TikTokProfile> {
  try {
    // TikTok V2 API requires a different endpoint with specific fields
    // See: https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info/
    const url = "https://open.tiktokapis.com/v2/user/info/";

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    // Log the raw response for debugging
    const responseText = await response.text();
    console.log("[TikTok] Profile Response:", responseText);

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      throw new Error(
        `Failed to parse TikTok profile response: ${responseText}+ ${e}`
      );
    }

    if (!response.ok) {
      throw new Error(
        `TikTok profile fetch failed: ${JSON.stringify(responseData)}`
      );
    }

    // TikTok v2 API response structure
    if (responseData?.data?.user) {
      const user = responseData.data.user;
      return {
        id: user.open_id || user.union_id,
        username: user.display_name,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        is_verified: user.is_verified,
        bio_description: user.bio_description,
      };
    }

    // Fallback to minimal profile based on the token exchange data
    return {
      id: responseData?.data?.open_id || "unknown_id",
      username: "TikTok User",
    };
  } catch (error) {
    console.error("Error fetching TikTok profile:", error);
    // Return minimal profile with the error information
    return {
      id: "error_fetching_profile",
      username: "TikTok User",
      display_name: "Error fetching profile",
    };
  }
}

/**
 * Makes a request to get the user's TikTok information using fields
 *
 * @param accessToken Valid TikTok access token
 * @returns TikTok profile information with additional details
 */
export async function getTikTokProfileDetails(
  accessToken: string
): Promise<TikTokProfile> {
  try {
    // Add trailing slash to match TikTok's API convention
    const url = "https://open.tiktokapis.com/v2/user/info/";

    // Use GET request instead of POST
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`TikTok profile details fetch failed: ${errorText}`);
    }

    const data = await response.json();

    if (data?.data?.user) {
      const user = data.data.user;
      return {
        id: user.open_id || user.union_id,
        username: user.display_name,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        is_verified: user.is_verified,
        bio_description: user.bio_description,
      };
    } else {
      throw new Error(
        `Invalid TikTok profile details response: ${JSON.stringify(data)}`
      );
    }
  } catch (error) {
    console.error("Error fetching TikTok profile details:", error);
    throw error;
  }
}
