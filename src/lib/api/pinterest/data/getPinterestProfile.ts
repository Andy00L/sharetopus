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
        username: "",
        first_name: "",
        last_name: "",
        full_name: "Pinterest User (Limited Access)",
        profile_image_url: "",
        is_verified: false,
        bio: `Account connected with limited permissions.`,
        business_name: "",
        follower_count: null,
        following_count: null,
      };
    }

    // Extract user data
    const supabaseUserData = data;

    return {
      id: supabaseUserData.id,
      username: supabaseUserData.username ?? "",
      first_name: supabaseUserData.first_name ?? "",
      last_name: supabaseUserData.last_name ?? "",
      full_name: supabaseUserData.full_name ?? "",
      profile_image_url: supabaseUserData.profile_image ?? null,
      is_verified: !!supabaseUserData.verified_user,
      bio: supabaseUserData.about ?? null,
      follower_count: supabaseUserData.follower_count ?? null,
      following_count: supabaseUserData.following_count ?? null,
      business_name: supabaseUserData.business_name ?? null,
    };
  } catch (error) {
    console.error("[Pinterest] Profile fetch error:", error);

    return {
      id: userId ?? "",
      username: "",
      first_name: "",
      last_name: "",
      full_name: "Pinterest User (Error)",
      profile_image_url: "",
      is_verified: false,
      bio: "Error fetching profile",
      business_name: "",
      follower_count: null,
      following_count: null,
    };
  }
}
