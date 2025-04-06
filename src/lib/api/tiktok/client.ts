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
 * @param openId Optional user's open_id from token response
 * @returns TikTok profile information */
export async function getTikTokProfile(
  accessToken: string,
  openId?: string
): Promise<TikTokProfile> {
  try {
    // Define fields to request
    const fields =
      "open_id,union_id,avatar_url,display_name,bio_description,is_verified";

    // TikTok V2 API requires a GET request with query parameters
    const url = `https://open.tiktokapis.com/v2/user/info/?fields=${encodeURIComponent(
      fields
    )}`;

    console.log("[TikTok] Making profile request to:", url);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    // Log the raw response for debugging
    const responseText = await response.text();
    console.log("[TikTok] Profile Response:", responseText);

    try {
      const responseData = JSON.parse(responseText);

      console.error(`responseData: ${responseData}`);
      // Check if we got valid user data
      if (
        responseData?.data?.user &&
        Object.keys(responseData.data.user).length > 0
      ) {
        const user = responseData.data.user;
        return {
          id: user.open_id || user.union_id || openId || "unknown_id",
          username: user.display_name || "TikTok User",
          display_name: user.display_name || "TikTok User",
          avatar_url: user.avatar_url,
          is_verified: !!user.is_verified,
          bio_description: user.bio_description,
        };
      }
    } catch (parseError) {
      console.error("[TikTok] Error parsing GET response:", parseError);
    }
    // Method 2: POST request with fields in body
    console.log("[TikTok] GET method failed, trying POST method");

    const postUrl = "https://open.tiktokapis.com/v2/user/info/";

    const postResponse = await fetch(postUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: fields,
      }),
    });

    // Log POST response
    const postResponseText = await postResponse.text();
    console.log("[TikTok] POST Response:", postResponseText);

    try {
      const postData = JSON.parse(postResponseText);

      if (postData?.data?.user && Object.keys(postData.data.user).length > 0) {
        const user = postData.data.user;
        return {
          id: user.open_id || user.union_id || openId || "unknown_id",
          username: user.display_name || "TikTok User",
          display_name: user.display_name || "TikTok User",
          avatar_url: user.avatar_url,
          is_verified: !!user.is_verified,
          bio_description: user.bio_description,
        };
      }
    } catch (postError) {
      console.error("[TikTok] Error parsing POST response:", postError);
    }

    // Method 3: Try alternative v1 endpoint as last resort
    console.log(
      "[TikTok] Both GET and POST methods failed, trying v1 endpoint"
    );

    const v1Url = "https://open-api.tiktok.com/user/info/";

    try {
      const v1Response = await fetch(v1Url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const v1ResponseText = await v1Response.text();
      console.log("[TikTok] V1 API Response:", v1ResponseText);

      const v1Data = JSON.parse(v1ResponseText);

      if (v1Data?.data?.user_info) {
        const user = v1Data.data.user_info;
        return {
          id: user.open_id || openId || "unknown_id",
          username: user.display_name || user.nickname || "TikTok User",
          display_name: user.display_name || user.nickname || "TikTok User",
          avatar_url: user.avatar_url || user.avatar,
          is_verified: !!user.is_verified,
          follower_count: user.follower_count,
          following_count: user.following_count,
          bio_description: user.bio_description,
        };
      }
    } catch (v1Error) {
      console.error("[TikTok] Error with v1 endpoint:", v1Error);
    }

    // If all methods fail, return minimal profile based on openId
    console.log("[TikTok] All methods failed, returning minimal profile");

    return {
      id: openId ?? "unknown_id",
      username: "TikTok User",
      display_name: "TikTok User",
    };
  } catch (error) {
    console.error("[TikTok] Profile fetch error:", error);

    // Return minimal profile when all attempts fail
    return {
      id: openId ?? "error_fetching_profile",
      username: "TikTok User",
      display_name: "TikTok User",
    };
  }
}
