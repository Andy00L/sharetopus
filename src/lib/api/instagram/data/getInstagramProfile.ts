// lib/api/instagram/apiResponse/getInstagramProfile.ts
import { InstagramProfile } from "@/lib/types/dbTypes";
import "server-only";

export interface InstagramProfileResult {
  success: boolean;
  message: string;
  data?: InstagramProfile;
}

export async function getInstagramProfile(
  accessToken: string,
  userId: string
): Promise<InstagramProfileResult> {
  try {
    // Define fields to request according to Instagram Business API documentation
    // instagram_business_basic scope is required for these details
    const fields = [
      "id",
      "user_id",
      "username",
      "name",
      "account_type",
      "media_count",
      "followers_count",
      "follows_count",
      "profile_picture_url",
    ].join(",");

    const url = `https://graph.instagram.com/v23.0/${encodeURIComponent(
      userId
    )}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(
      accessToken
    )}`;

    console.log("[Instagram] Requesting profile from API...");

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error("[Instagram] HTTP error:", {
        status: response.status,
        statusText: response.statusText,
        response: responseText,
      });

      return {
        success: false,
        message: `Instagram API returned ${response.status}: ${response.statusText}`,
      };
    }

    const data = JSON.parse(responseText);

    // Check for Instagram API errors
    if (data.error_type || data.error_message || data.error) {
      console.error("[Instagram] API returned error:", {
        error_type: data.error_type,
        error_message: data.error_message,
        error: data.error,
        full_response: data,
      });
      return {
        success: false,
        message: `Instagram profile fetch failed: ${
          data.error_message ?? data.error?.message ?? "Unknown error"
        }. Please try again.`,
      };
    }

    // Instagram API peut retourner soit { data: [...] } soit directement les données
    const profileData = data;

    // Validate that we have basic required data
    if (!profileData.id && !profileData.user_id) {
      console.error("[Instagram] Missing required fields in response:", {
        has_id: !!profileData.id,
        has_user_id: !!profileData.user_id,
        received_data: data,
      });
      return {
        success: false,
        message:
          "Instagram didn't provide the required profile information. Please try connecting again.",
      };
    }

    const profileResponse: InstagramProfile = {
      id: profileData.user_id,
      username: profileData.username,
      name: profileData.name ?? profileData.username,
      account_type: profileData.account_type,
      profile_picture_url: profileData.profile_picture_url,
      media_count: profileData.media_count,
      followers_count: profileData.followers_count,
      follows_count: profileData.follows_count,
    };

    return {
      success: true,
      message: "Instagram profile retrieved successfully.",
      data: profileResponse,
    };
  } catch (error) {
    console.error("[Instagram] Unexpected error during profile fetch:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return {
      success: false,
      message:
        "An unexpected error occurred while fetching your Instagram profile. Please try again.",
    };
  }
}
