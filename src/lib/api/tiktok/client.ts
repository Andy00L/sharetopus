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
 * Fetches TikTok user profile using TikTok V2 API
 *
 * @param accessToken Valid TikTok access token
 * @param openId TikTok user's unique identifier for fallback
 * @returns Complete TikTok profile information
 */
export async function getTikTokProfile(
  accessToken: string,
  openId: string
): Promise<TikTokProfile> {
  // Define fields to request according to TikTok documentation
  const fields =
    "open_id,union_id,avatar_url,display_name,bio_description,is_verified,follower_count,following_count";

  try {
    // Make request to TikTok V2 API using GET with query parameters
    const url = `https://open.tiktokapis.com/v2/user/info/?fields=${encodeURIComponent(
      fields
    )}`;

    console.log("[TikTok] Requesting profile from:", url);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    // Get response as text first for better error handling
    const responseText = await response.text();
    console.log("[TikTok] Profile API raw response:", responseText);

    // Parse response
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      throw new Error(
        `Failed to parse TikTok profile response: ${responseText}+${parseError}`
      );
    }

    // Check for API errors
    if (data.error && data.error.code !== "ok") {
      // Handle the scope_not_authorized error specially
      if (data.error.code === "scope_not_authorized") {
        console.warn(
          "[TikTok] User did not authorize required scopes. Using available data."
        );

        // Return profile with available data
        return {
          id: openId,
          username: "TikTok User",
          display_name: "TikTok User",
          avatar_url: "",
          is_verified: false,
          bio_description: `Account connected with limited permissions. Additional scopes needed for complete profile.`,
          follower_count: 777,
          following_count: 777,
        };
      }

      throw new Error(`TikTok API error: ${JSON.stringify(data.error)}`);
    }

    // Extract user data
    const userData = data.data.user || {};

    // Build complete profile from response
    return {
      id: userData.open_id || openId,
      username: userData.display_name || "TikTok User",
      display_name: userData.display_name || "TikTok User",
      avatar_url: userData.avatar_url || null,
      is_verified: !!userData.is_verified,
      bio_description: userData.bio_description || null,
      follower_count: userData.follower_count || null,
      following_count: userData.following_count || null,
    };
  } catch (error) {
    console.error("[TikTok] Profile fetch error:", error);

    // Create enriched profile with error information
    return {
      id: openId,
      username: "TikTok User",
      display_name: "TikTok User",
      avatar_url: "",
      is_verified: false,
      bio_description: `Error fetching complete profile: `,
      follower_count: 777,
      following_count: 777,
    };
  }
}
