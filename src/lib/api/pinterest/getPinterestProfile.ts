// lib/api/pinterest/getPinterestProfile.ts

import { PinterestProfile } from "@/lib/types/PinterestProfile ";

export async function getPinterestProfile(
  accessToken: string,
  userId?: string
): Promise<PinterestProfile> {
  try {
    const url = "https://api.pinterest.com/v5/user_account";
    console.log("[Pinterest] Requesting profile from:", url);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const responseText = await response.text();
    console.log("[Pinterest] Profile API raw response:", responseText);

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error("[Pinterest] Failed to parse API response:", parseError);
      throw new Error(
        `Failed to parse Pinterest profile response: ${responseText}`
      );
    }

    if (!response.ok || data.error) {
      console.warn(`[Pinterest] API returned an error:`, data.error);

      return {
        id: userId ?? "",
        username: `pinterest_user_${userId?.substring(0, 6)}`,
        first_name: "",
        last_name: "",
        full_name: "Pinterest User (Limited Access)",
        profile_image_url: "",
        is_verified: false,
        bio: `Account connected with limited permissions.`,
        follower_count: null,
        following_count: null,
      };
    }

    // Extract user data
    const userData = data;

    return {
      id: userData.id,
      username:
        userData.username ?? `pinterest_user_${userId?.substring(0, 6)}`,
      first_name: userData.first_name ?? "",
      last_name: userData.last_name ?? "",
      full_name: userData.full_name ?? "Pinterest User",
      profile_image_url: userData.profile_image ?? null,
      is_verified: !!userData.verified_user,
      bio: userData.about ?? null,
      follower_count: userData.follower_count ?? null,
      following_count: userData.following_count ?? null,
    };
  } catch (error) {
    console.error("[Pinterest] Profile fetch error:", error);

    return {
      id: userId ?? "",
      username: `pinterest_user_${userId?.substring(0, 6)}`,
      first_name: "",
      last_name: "",
      full_name: "Pinterest User (Error)",
      profile_image_url: "",
      is_verified: false,
      bio: `Error fetching profile: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      follower_count: null,
      following_count: null,
    };
  }
}
