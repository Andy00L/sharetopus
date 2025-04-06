import { TikTokProfile } from "@/actions/types/TikTokProfile";

// lib/api/tiktok/client.ts
export async function getTikTokProfile(
  accessToken: string,
  openId?: string
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
      console.error("[TikTok] Failed to parse API response:", parseError);
      throw new Error(
        `Failed to parse TikTok profile response: ${responseText}`
      );
    }

    // Check for API errors
    if (data.error) {
      console.warn("[TikTok] API returned an error:", data.error);

      // Handle the scope_not_authorized error specifically
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
          follower_count: 0,
          following_count: 0,
        };
      }

      throw new Error(`TikTok API error: ${JSON.stringify(data.error)}`);
    }

    // Extract user data - handle the case where data.data could be empty
    const userData = (data.data && data.data.user) || {};

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

    // Create fallback profile with error information
    return {
      id: openId,
      username: "TikTok User",
      display_name: "TikTok User",
      avatar_url: "",
      is_verified: false,
      bio_description: `Error fetching complete profile: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      follower_count: 0,
      following_count: 0,
    };
  }
}
