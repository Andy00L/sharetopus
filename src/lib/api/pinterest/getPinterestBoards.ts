// lib/api/pinterest/getPinterestBoards.ts

export interface PinterestBoard {
  id: string;
  name: string;
  description?: string;
  owner?: {
    username?: string;
  };
  privacy?: string;
}

// Define type for Pinterest API response
interface PinterestBoardsResponse {
  items: Array<{
    id: string;
    name: string;
    description?: string;
    owner?: {
      username?: string;
    };
    privacy?: string;
    [key: string]: unknown; // For any other properties we don't use
  }>;
  bookmark?: string | null;
}

/**
 * Fetches all Pinterest boards for the user
 *
 * @param accessToken Pinterest API access token
 * @returns Array of Pinterest boards
 */
export async function getPinterestBoards(
  accessToken: string
): Promise<PinterestBoard[]> {
  try {
    console.log(
      "[Pinterest] Fetching user boards with token:",
      accessToken.substring(0, 10) + "..."
    );

    // Pinterest API endpoint for listing boards
    const url = "https://api.pinterest.com/v5/boards";

    console.log("[Pinterest] Making API request to:", url);
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    // Log the response status
    console.log(
      "[Pinterest] API response status:",
      response.status,
      response.statusText
    );

    const responseText = await response.text();
    console.log("[Pinterest] API raw response:", responseText);

    if (!response.ok) {
      console.error("[Pinterest] Failed to fetch boards:", responseText);
      throw new Error(
        `Pinterest API error: ${response.status} - ${responseText}`
      );
    }

    let data;
    try {
      data = JSON.parse(responseText);
      console.log("[Pinterest] Successfully parsed response:", data);
    } catch (parseError) {
      console.error("[Pinterest] Failed to parse response:", parseError);
      throw new Error("Failed to parse Pinterest API response");
    }

    if (!data.items || !Array.isArray(data.items)) {
      console.warn(
        "[Pinterest] No boards found or invalid response format. Response:",
        data
      );
      return [];
    }

    const boards = data.items.map(
      (board: PinterestBoardsResponse["items"][0]) => ({
        id: board.id,
        name: board.name,
        description: board.description,
        owner: board.owner,
        privacy: board.privacy,
      })
    );

    console.log("[Pinterest] Successfully fetched boards:", boards.length);
    return boards;
  } catch (error) {
    console.error("[Pinterest] Error fetching boards:", error);
    throw error;
  }
}
