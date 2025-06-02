// lib/api/instagram/data/getInstagramProfile.ts
import { InstagramProfile } from "@/lib/types/dbTypes";
import "server-only";

export async function getInstagramProfile(
  accessToken: string,
  userId?: string
): Promise<InstagramProfile> {
  try {
    // Define fields to request according to Instagram Business API documentation
    // instagram_business_basic scope is required for these details
    const fields = [
      "id",
      "username",
      "name",
      "account_type",
      "media_count",
      "followers_count",
      "follows_count",
      "profile_picture_url",
      "biography",
    ].join(",");

    const url = `https://graph.instagram.com/me?fields=${encodeURIComponent(
      fields
    )}&access_token=${accessToken}`;

    console.log(
      "[Instagram] Requesting profile from:",
      url.replace(accessToken, "***")
    );

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const responseText = await response.text();
    console.log("[Instagram] Profile API raw response:", responseText);

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error("[Instagram] Failed to parse API response:", parseError);
      throw new Error(
        `Failed to parse Instagram profile response: ${responseText}`
      );
    }

    // Check for Instagram API errors
    if (data.error) {
      console.warn(`[Instagram] API returned an error:`, data.error);

      // Handle specific error cases
      if (data.error.code === 190) {
        // Invalid access token
        throw new Error("Instagram access token is invalid or expired");
      }

      if (data.error.code === 10) {
        // Application does not have permission for this action
        console.warn(
          "[Instagram] Application doesn't have required permissions. Returning basic info."
        );
        return {
          id: userId || "",
          username: `instagram_user_${userId?.substring(0, 6) || "unknown"}`,
          name: "Instagram User (Limited Access)",
          account_type: "BUSINESS",
          profile_picture_url: "",
          biography:
            "Account connected with limited permissions. Required permissions missing.",
          media_count: null,
          followers_count: null,
          follows_count: null,
        };
      }

      // For other errors, throw
      throw new Error(
        `Instagram API error (${data.error.code}): ${data.error.message}`
      );
    }

    // Validate that we have basic required data
    if (!data.id) {
      console.warn("[Instagram] Profile data missing required fields.");
      return {
        id: userId || "",
        username: `instagram_user_${userId?.substring(0, 6) || "unknown"}`,
        name: "Instagram User (Data Missing)",
        account_type: "BUSINESS",
        profile_picture_url: "",
        biography: "Could not retrieve profile details from API response.",
        media_count: null,
        followers_count: null,
        follows_count: null,
      };
    }

    // Build complete profile from response
    console.log("[Instagram] Successfully parsed profile data:", {
      id: data.id,
      username: data.username,
      account_type: data.account_type,
    });

    return {
      id: data.id,
      username: data.username || `instagram_user_${data.id.substring(0, 6)}`,
      name: data.name || data.username || "Instagram User",
      account_type: data.account_type || "BUSINESS", // PERSONAL, BUSINESS, or CREATOR
      profile_picture_url: data.profile_picture_url || "",
      biography: data.biography || "",
      media_count: data.media_count || null,
      followers_count: data.followers_count || null,
      follows_count: data.follows_count || null,
    };
  } catch (error) {
    console.error("[Instagram] Profile fetch error:", error);

    // Create fallback profile indicating a fetch error
    return {
      id: userId || "",
      username: `instagram_user_${userId?.substring(0, 6) || "unknown"}`,
      name: "Instagram User (Error)",
      account_type: "BUSINESS",
      profile_picture_url: "",
      biography: `Error fetching profile: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      media_count: null,
      followers_count: null,
      follows_count: null,
    };
  }
}
