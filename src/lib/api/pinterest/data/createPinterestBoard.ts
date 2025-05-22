"use server";

import { PinterestBoard } from "./getPinterestBoards";

/**
 * Creates a new Pinterest board
 *
 * @param accessToken Pinterest API access token
 * @param name Name of the board to create
 * @param description Optional description for the board
 * @returns The created board data or null if failed
 */
export async function createPinterestBoard(
  accessToken: string | null,
  name: string,
  description?: string
): Promise<PinterestBoard | null> {
  if (!accessToken) {
    console.error("[CreatePinterestBoard] No access token provided");
    return null;
  }

  if (!name.trim()) {
    console.error("[CreatePinterestBoard] No board name provided");
    return null;
  }

  try {
    console.log(
      "[CreatePinterestBoard] Creating board with token:",
      accessToken.substring(0, 10) + "..."
    );

    const url = "https://api.pinterest.com/v5/boards";

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        description: description ?? "",
      }),
    });

    console.log(
      `[CreatePinterestBoard] API response status: ${response.status}`
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(
        `[CreatePinterestBoard] API error: ${response.status} ${response.statusText}`,
        errorData
      );
      return null;
    }

    const data = await response.json();
    console.log(
      "[CreatePinterestBoard] Board created successfully:",
      data.name
    );

    return {
      id: data.id,
      name: data.name,
      description: data.description,
    };
  } catch (error) {
    console.error("[CreatePinterestBoard] Unexpected error:", error);
    return null;
  }
}
