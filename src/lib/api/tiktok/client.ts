// lib/api/tiktok/client.ts
import { TikTokProfile } from "@/actions/types/TikTokProfile"; // Adjust path if needed

export async function getTikTokProfile(
  accessToken: string,
  openId?: string // Ensure openId is passed and is a string
): Promise<TikTokProfile> {
  // Define fields to request according to TikTok documentation
  // user.info.profile scope is required for these details
  const fields =
    "open_id,union_id,avatar_url,display_name,bio_description,is_verified,follower_count,following_count";

  try {
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

    const responseText = await response.text();
    console.log("[TikTok] Profile API raw response:", responseText);

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error("[TikTok] Failed to parse API response:", parseError);
      throw new Error(
        `Failed to parse TikTok profile response: ${responseText}`
      );
    }

    if (data.error) {
      console.warn("[TikTok] API returned an error:", data.error);

      // Handle specific errors - scope_not_authorized is common
      if (data.error.code === "scope_not_authorized") {
        console.warn(
          "[TikTok] User did not authorize 'user.info.profile' scope. Returning basic info."
        );
        // Return profile with available data and clear indication of limitation
        return {
          id: openId, // Use the openId passed from token exchange
          username: `tiktok_user_${openId?.substring(0, 6)}`, // Create a placeholder username
          display_name: "TikTok User (Limited Access)", // Indicate limited access
          avatar_url: "", // No avatar available without scope
          is_verified: false,
          bio_description: `Account connected with limited permissions. Scope 'user.info.profile' needed for full profile.`,
          follower_count: null, // Use null for unknown counts
          following_count: null,
        };
      }
      // Throw other API errors
      throw new Error(
        `TikTok API error (${data.error.code}): ${data.error.message}`
      );
    }

    // Extract user data - handle the case where data.data or data.data.user might be missing
    const userData = data?.data?.user;
    if (!userData) {
      console.warn("[TikTok] Profile data block missing in API response.");
      // Return fallback if user data is unexpectedly missing
      return {
        id: openId,
        username: `tiktok_user_${openId?.substring(0, 6)}`,
        display_name: "TikTok User (Data Missing)",
        avatar_url: "",
        is_verified: false,
        bio_description:
          "Could not retrieve profile details from API response.",
        follower_count: null,
        following_count: null,
      };
    }

    // Build complete profile from response
    return {
      id: userData.open_id || openId, // Prefer open_id from profile data if available
      username:
        userData.display_name || `tiktok_user_${openId?.substring(0, 6)}`, // Use display_name or fallback
      display_name: userData.display_name || "TikTok User",
      avatar_url: userData.avatar_url || null, // Use null if empty
      is_verified: !!userData.is_verified,
      bio_description: userData.bio_description || null,
      follower_count: userData.follower_count ?? null, // Use null coalescing for counts
      following_count: userData.following_count ?? null,
    };
  } catch (error) {
    console.error("[TikTok] Profile fetch error:", error);
    // Create fallback profile indicating a fetch error
    return {
      id: openId,
      username: `tiktok_user_${openId?.substring(0, 6)}`,
      display_name: "TikTok User (Error)",
      avatar_url: "",
      is_verified: false,
      bio_description: `Error fetching profile: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      follower_count: null,
      following_count: null,
    };
  }
}
