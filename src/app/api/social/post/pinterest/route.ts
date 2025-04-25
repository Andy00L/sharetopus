import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const {
      accessToken,
      boardId,
      title,
      description,
      link,
      base64Media,
      mediaType,
    } = await request.json();
    // Log the received parameters (truncating sensitive data)
    console.log("[Pinterest Post] Received parameters:");
    console.log("[Pinterest Post] boardId:", boardId);
    console.log("[Pinterest Post] title:", title);
    console.log(
      "[Pinterest Post] description length:",
      description?.length || 0
    );
    console.log("[Pinterest Post] link:", link);
    console.log("[Pinterest Post] mediaType:", mediaType);
    console.log(
      "[Pinterest Post] accessToken:",
      accessToken ? `${accessToken.substring(0, 6)}...` : "missing"
    );
    console.log(
      "[Pinterest Post] base64Media length:",
      base64Media ? base64Media.length : 0
    );
    // Vérification des paramètres requis
    if (!accessToken || !boardId || !base64Media) {
      console.log(" [Pinterest Post route] Missing required parameters");
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    // Determine if we're posting an image or video
    const isImage = mediaType.startsWith("image/");
    const isVideo = mediaType.startsWith("video/");

    if (!isVideo && !isImage) {
      console.log("[Pinterest Post] Unsupported media type:", mediaType);
      return NextResponse.json(
        {
          success: false,
          error: "Unsupported media type. Must be image or video.",
        },
        { status: 400 }
      );
    }

    // Set the source type based on media type
    const sourceType = isImage ? "image_base64" : "video_base64";

    console.log(
      `[Pinterest Post] Creating ${isImage ? "image" : "video"} pin on board:`,
      boardId
    );

    // Appel à l'API Pinterest
    const pinterestResponse = await fetch("https://api.pinterest.com/v5/pins", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        link,
        title,
        description,
        board_id: boardId,
        media_source: {
          source_type: sourceType,
          content_type: mediaType,
          data: base64Media,
        },
      }),
    });

    console.log(
      "[Pinterest Post route] pinterestResponse: ",
      pinterestResponse
    );

    if (!pinterestResponse.ok) {
      const err = await pinterestResponse.json();
      console.error("[Pinterest Post Routes.ts] Pinterest error body:", err);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to post to Pinterest",
          details: err.missing ?? "Unknown error",
        },
        { status: pinterestResponse.status }
      );
    }

    // Return success response
    const data = await pinterestResponse.json();
    console.log("[Pinterest Post API] Successfully posted to Pinterest");

    return NextResponse.json({
      success: true,
      data,
      message: `Successfully created ${
        isImage ? "image" : "video"
      } pin on Pinterest`,
    });
  } catch (error) {
    console.error("[Pinterest Post API] Unexpected error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to post to Pinterest",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
