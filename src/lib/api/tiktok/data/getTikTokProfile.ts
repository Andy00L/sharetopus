import "server-only";
import { PLATFORM_API_TIMEOUT_MS } from "@/lib/api/_shared/platformFetchTimeouts";
import { TikTokProfile } from "@/lib/types/socialProfiles";

export async function getTikTokProfile(
  accessToken: string,
  openId: string
): Promise<TikTokProfile> {
  const fields =
    "open_id,union_id,avatar_url,display_name,bio_description,is_verified,follower_count,following_count";

  try {
    const url = `https://open.tiktokapis.com/v2/user/info/?fields=${encodeURIComponent(
      fields
    )}`;
    console.log("[getTikTokProfile] Requesting profile from:", url);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(PLATFORM_API_TIMEOUT_MS),
    });

    const responseText = await response.text();

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error("[getTikTokProfile] Failed to parse API response:", parseError);
      return {
        id: openId,
        username: `tiktok_user_${openId.substring(0, 6)}`,
        display_name: "TikTok User (Error)",
        avatar_url: "",
        is_verified: false,
        bio_description: "Error parsing TikTok profile response",
        follower_count: null,
        following_count: null,
      };
    }
    if (data.error && data.error.code !== "ok") {
      console.warn(
        `[getTikTokProfile] API returned an error code: ${data.error.code}`,
        data.error
      );
      if (data.error.code === "scope_not_authorized") {
        console.warn(
          "[getTikTokProfile] User did not authorize required scope(s). Returning basic info."
        );
        return {
          id: openId,
          username: `tiktok_user_${openId.substring(0, 6)}`,
          display_name: "TikTok User (Limited Access)",
          avatar_url: "",
          is_verified: false,
          bio_description: `Account connected with limited permissions. Required scope(s) missing.`,
          follower_count: null,
          following_count: null,
        };
      }
      return {
        id: openId,
        username: `tiktok_user_${openId.substring(0, 6)}`,
        display_name: "TikTok User (Error)",
        avatar_url: "",
        is_verified: false,
        bio_description: `TikTok API error (${data.error.code}): ${data.error.message}`,
        follower_count: null,
        following_count: null,
      };
    }

    const userData = data?.data?.user;
    if (!userData) {
      console.warn("[getTikTokProfile] Profile data block missing in API response.");
      return {
        id: openId,
        username: `tiktok_user_${openId.substring(0, 6)}`,
        display_name: "TikTok User (Data Missing)",
        avatar_url: "",
        is_verified: false,
        bio_description:
          "Could not retrieve profile details from API response.",
        follower_count: null,
        following_count: null,
      };
    }

    return {
      id: userData.open_id ?? openId,
      username:
        userData.display_name ?? `tiktok_user_${openId.substring(0, 6)}`,
      display_name: userData.display_name ?? "TikTok User",
      avatar_url: userData.avatar_url ?? null,
      is_verified: !!userData.is_verified,
      bio_description: userData.bio_description ?? null,
      follower_count: userData.follower_count ?? null,
      following_count: userData.following_count ?? null,
    };
  } catch (error) {
    console.error("[getTikTokProfile] Profile fetch error:", error);
    return {
      id: openId,
      username: `tiktok_user_${openId.substring(0, 6)}`,
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
