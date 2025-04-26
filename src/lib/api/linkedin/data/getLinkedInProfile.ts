// lib/api/linkedin/getLinkedInProfile.ts

import { LinkedInProfile } from "@/lib/types/LinkedinProfile";

export async function getLinkedInProfile(
  accessToken: string,
  userId?: string
): Promise<LinkedInProfile> {
  try {
    const url = "https://api.linkedin.com/v2/userinfo";
    console.log("[getLinkedInProfile] Requesting profile from:", url);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const responseText = await response.text();
    console.log("[getLinkedInProfile] Profile API raw response:", responseText);

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error(
        "[getLinkedInProfile] Failed to parse API response:",
        parseError
      );
      throw new Error(
        `Failed to parse getLinkedInProfile profile response: ${responseText}`
      );
    }

    if (!response.ok || data.error) {
      console.warn(`[getLinkedInProfile] API returned an error:`, data.error);

      return {
        id: userId ?? "",
        name: "Linkedin User (Limited Access)",
        given_name: "",
        family_name: "",
        email: "",
        picture: "",
        locale: "",
        email_verified: false,
      };
    }

    // Extract user data from response
    return {
      id: data.sub ?? "",
      name: data.name ?? "",
      given_name: data.given_name ?? "",
      family_name: data.family_name ?? "",
      email: data.email ?? "",
      picture: data.picture ?? "",
      locale: data.locale ?? "",
      email_verified: !!data.email_verified,
    };
  } catch (error) {
    console.error("[getLinkedInProfile] Profile fetch error:", error);

    return {
      id: userId ?? "",
      name: "Linkedin User (Error)",
      given_name: "",
      family_name: "",
      email: "",
      picture: "",
      locale: "",
      email_verified: false,
    };
  }
}
