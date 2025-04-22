// lib/api/pinterest/data/getPinterestBoards.ts
"use server";
export interface PinterestBoard {
  id: string;
  name: string;
  description?: string;
}

/**
 * Fetches all Pinterest boards for the user
 *
 * @param accessToken Pinterest API access token
 * @param pinterest_user_id Optional user ID, will be fetched automatically if not provided
 * @returns Array of Pinterest boards
 */
export async function getPinterestBoards(
  accessToken: string | null
): Promise<PinterestBoard[]> {
  if (!accessToken) {
    console.error("[Pinterest] No access token provided");
    return [];
  }
  console.log("[Pinterest] Verifying token and user data");

  try {
    console.log(
      "[Pinterest] Fetching boards with token:",
      accessToken.substring(0, 10) + "..."
    );

    // First try the main endpoint
    const url = "https://api.pinterest.com/v5/boards";
    console.log("[Pinterest] Using primary API endpoint");

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    console.log(`[Pinterest] Primary API response status: ${response.status}`);

    if (!response.ok) {
      console.error(
        `[Pinterest] API error: ${response.status} ${response.statusText}`
      );
      return [];
    }
    const data = await response.json();

    return data.items ?? [];
  } catch (error) {
    console.error("[Pinterest] Unexpected error:", error);
    return [];
  }
}
