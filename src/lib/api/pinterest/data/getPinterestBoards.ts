// lib/api/pinterest/getPinterestBoardsFixed.ts

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
  accessToken: string | null
): Promise<PinterestBoard[]> {
  try {
    console.log(
      "[Pinterest] Fetching user boards with token:",
      accessToken?.substring(0, 10) + "..."
    );

    // Attempt to fetch user ID first
    const userUrl = "https://api.pinterest.com/v5/user_account";
    console.log("[Pinterest] Getting user account data from:", userUrl);

    const userResponse = await fetch(userUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    console.log(
      "[Pinterest] User API response status:",
      userResponse.status,
      userResponse.statusText
    );
    const userText = await userResponse.text();
    console.log("[Pinterest] User API raw response:", userText);

    let userId = "";
    try {
      const userData = JSON.parse(userText);
      userId = userData.id ?? "";
      console.log("[Pinterest] User ID retrieved:", userId);
    } catch (e) {
      console.error("[Pinterest] Failed to parse user response:", e);
    }

    // Pinterest API endpoint for listing boards
    // Try the main boards endpoint first
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

    // If main endpoint fails, try user-specific endpoint as fallback
    if (!response.ok && userId) {
      console.log(
        "[Pinterest] Main endpoint failed, trying user-specific endpoint"
      );

      const userBoardsUrl = `https://api.pinterest.com/v5/boards?creator=${userId}`;
      console.log("[Pinterest] Making API request to:", userBoardsUrl);

      const userBoardsResponse = await fetch(userBoardsUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });

      console.log(
        "[Pinterest] User boards API response status:",
        userBoardsResponse.status,
        userBoardsResponse.statusText
      );

      const userBoardsText = await userBoardsResponse.text();
      console.log("[Pinterest] User boards API raw response:", userBoardsText);

      if (!userBoardsResponse.ok) {
        console.error("[Pinterest] Failed to fetch boards from both endpoints");
        return [];
      }

      try {
        const data = JSON.parse(userBoardsText);
        console.log(
          "[Pinterest] Successfully parsed user boards response:",
          data
        );

        if (!data.items || !Array.isArray(data.items)) {
          console.warn("[Pinterest] No boards found in user-specific response");
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

        console.log(
          "[Pinterest] Successfully fetched boards via user endpoint:",
          boards.length
        );
        return boards;
      } catch (parseError) {
        console.error(
          "[Pinterest] Failed to parse user boards response:",
          parseError
        );
        return [];
      }
    }

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
    return []; // Return empty array instead of throwing to prevent component errors
  }
}
