// lib/api/pinterest/createPinterestPin.ts

export interface PinterestPinResponse {
  id: string;
  link?: string;
  title?: string;
  description?: string;
  created_at?: string;
  board_id?: string;
  media?: {
    images?: {
      original?: {
        url?: string;
        width?: number;
        height?: number;
      };
    };
  };
}

export interface PinterestPinRequest {
  board_id: string;
  media_source: {
    source_type: "image_url" | "image_base64";
    url?: string;
    content_type?: string;
    data?: string;
  };
  title?: string;
  description?: string;
  alt_text?: string;
  link?: string;
}

/**
 * Creates a new Pin on Pinterest
 *
 * @param accessToken Pinterest API access token
 * @param pinData Pin data including board_id, media source, and other optional metadata
 * @returns Pinterest Pin response with the created pin ID
 */
export async function createPinterestPin(
  accessToken: string,
  pinData: PinterestPinRequest
): Promise<PinterestPinResponse> {
  try {
    console.log(`[Pinterest] Creating pin on board ${pinData.board_id}`);

    // Pinterest API endpoint for creating pins
    const url = "https://api.pinterest.com/v5/pins";

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pinData),
    });

    const responseText = await response.text();
    console.log("[Pinterest] Pin creation response:", responseText);

    if (!response.ok) {
      console.error("[Pinterest] Failed to create pin:", responseText);
      throw new Error(
        `Pinterest API error: ${response.status} - ${responseText}`
      );
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      throw new Error(
        `Failed to parse Pinterest pin creation response: ${responseText}+ ${e}`
      );
    }

    return data;
  } catch (error) {
    console.error("[Pinterest] Error creating pin:", error);
    throw error;
  }
}

/**
 * Helper function to create a Pin from an image URL
 */
export async function createPinterestPinFromUrl(
  accessToken: string,
  boardId: string,
  imageUrl: string,
  options: {
    title?: string;
    description?: string;
    link?: string;
    altText?: string;
  } = {}
): Promise<PinterestPinResponse> {
  const pinData: PinterestPinRequest = {
    board_id: boardId,
    media_source: {
      source_type: "image_url",
      url: imageUrl,
    },
    title: options.title,
    description: options.description,
    link: options.link,
    alt_text: options.altText,
  };

  return createPinterestPin(accessToken, pinData);
}

/**
 * Helper function to create a Pin from a base64 encoded image
 */
export async function createPinterestPinFromBase64(
  accessToken: string,
  boardId: string,
  base64Data: string,
  contentType: string,
  options: {
    title?: string;
    description?: string;
    link?: string;
    altText?: string;
  } = {}
): Promise<PinterestPinResponse> {
  const pinData: PinterestPinRequest = {
    board_id: boardId,
    media_source: {
      source_type: "image_base64",
      content_type: contentType,
      data: base64Data,
    },
    title: options.title,
    description: options.description,
    link: options.link,
    alt_text: options.altText,
  };

  return createPinterestPin(accessToken, pinData);
}
