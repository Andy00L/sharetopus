// lib/api/pinterest/data/getPinterestBoards.ts
"use server";

import { checkRateLimit } from "@/actions/server/reddis/rate-limit";

export interface PinterestBoard {
  id: string;
  name: string;
  description?: string;
}

export interface PinterestBoardsResponse {
  boards: PinterestBoard[];
  success: boolean;
}

/**
 * Fetches all Pinterest boards for the user
 *
 * @param accessToken Pinterest API access token
 * @param pinterest_user_id Optional user ID, will be fetched automatically if not provided
 * @returns Array of Pinterest boards
 */
export async function getPinterestBoards(
  accessToken: string | null,
  userId: string | null
): Promise<PinterestBoardsResponse> {
  if (!accessToken) {
    console.error("[GetPinterestBoards] No access token provided");
    return {
      boards: [],
      success: false,
    };
  }
  const rateCheck = await checkRateLimit(
    "getPinterestBoards", // Unique identifier for this operation
    userId, // User identifier
    15, // Limit (30 requests)
    60 // Window (60 seconds)
  );
  if (!rateCheck.success) {
    console.warn(
      `[fetchSocialAccounts]: Rate limit exceeded for user: ${userId}. Reset in: ${
        rateCheck.resetIn ?? "unknown"
      } seconds`
    );
    return {
      boards: [],
      success: false,
    };
  }
  try {
    console.log("[GetPinterestBoards] Fetching boards with token");

    // First try the main endpoint
    const url = "https://api.pinterest.com/v5/boards";

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    console.log(
      `[GetPinterestBoards] Primary API response status: ${response.status}`
    );

    if (!response.ok) {
      console.error(
        `[GetPinterestBoards] API error: ${response.status} ${response.statusText}`
      );
      return {
        boards: [],
        success: false,
      };
    }
    const data = await response.json();
    console.log(`[GetPinterestBoards] : ${data.items[0].name}`);
    return {
      boards: (data.items ?? []) as PinterestBoard[],
      success: true,
    };
  } catch (error) {
    console.error("[GetPinterestBoards] Unexpected error:", error);
    return {
      boards: [],
      success: false,
    };
  }
}
