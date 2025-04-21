// lib/api/pinterest/data/getPinterestBoards.ts

export interface PinterestBoard {
  id: string;
  name: string;
  description?: string;
}

/**
 * Fetches all Pinterest boards for the user
 *
 * @param accessToken Pinterest API access token
 * @returns Array of Pinterest boards
 */
export async function getPinterestBoards(
  accessToken: string | null,
  pinterest_user_id: string | null
): Promise<PinterestBoard[]> {
  if (!accessToken) {
    console.error("[Pinterest] No access token provided");
    return [];
  }
  console.log(accessToken);

  try {
    console.log(
      "[Pinterest] Fetching boards with token:",
      accessToken.substring(0, 10) + "..."
    );

    // Pinterest API V5 endpoint for boards
    const url = `https://api.pinterest.com/v5/users/${pinterest_user_id}/boards`;

    console.log("[Pinterest] Using API endpoint:", url);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    console.log("[Pinterest] API response status:", response.status);

    const responseText = await response.text();
    console.log("[Pinterest] API raw response:", responseText);

    if (!response.ok) {
      console.error("[Pinterest] API error:", response.status, responseText);
      return [];
    }

    try {
      const data = JSON.parse(responseText);

      // Validate expected response format
      if (!data.items || !Array.isArray(data.items)) {
        console.warn(
          "[Pinterest] Unexpected response format. Missing 'items' array."
        );
        return [];
      }

      // Convert API response to our format
      const boards = data.items.map((board: PinterestBoard) => ({
        id: board.id,
        name: board.name,
        description: board.description,
      }));

      console.log("[Pinterest] Successfully retrieved boards:", boards.length);
      return boards;
    } catch (parseError) {
      console.error("[Pinterest] Failed to parse API response:", parseError);
      return [];
    }
  } catch (error) {
    console.error("[Pinterest] Unexpected error:", error);
    return [];
  }
}
