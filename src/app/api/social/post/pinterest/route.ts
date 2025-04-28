import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized - Authentication required" },
        { status: 401 }
      );
    }

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
    console.log("[Pinterest Post Routes] Received parameters:");
    console.log("[Pinterest Post Routes] boardId:", boardId);
    console.log("[Pinterest Post Routes] title:", title);
    console.log(
      "[Pinterest Post Routes] description length:",
      description?.length ?? 0
    );
    console.log("[Pinterest Post Routes] link:", link);
    console.log("[Pinterest Post Routes] mediaType:", mediaType);
    console.log(
      "[Pinterest Post Routes] accessToken:",
      accessToken ? `${accessToken.substring(0, 6)}...` : "missing"
    );
    console.log(
      "[Pinterest Post Routes] base64Media length:",
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
      console.log("[Pinterest Post Routes] Unsupported media type:", mediaType);
      return NextResponse.json(
        {
          success: false,
          error: "Unsupported media type. Must be image or video.",
        },
        { status: 400 }
      );
    }

    // Validate required fields for video uploads
    if (isVideo && !title) {
      console.log(
        "[Pinterest Post Routes] Missing required title for video pin"
      );
      return NextResponse.json(
        {
          success: false,
          error: "Title is required for video pins",
        },
        { status: 400 }
      );
    }

    // Set the source type based on media type
    const sourceType = isImage ? "image_base64" : "video_base64";

    console.log(
      `[Pinterest Post Routes] Creating ${
        isImage ? "image" : "video"
      } pin on board:`,
      boardId
    );

    // Construct request body based on media type
    const requestBody = {
      link,
      title,
      description,
      board_id: boardId,
      media_source: {
        source_type: sourceType,
        content_type: mediaType,
        data: base64Media,
        is_standard: false,
      },
    };

    // If video, we need to add additional fields that Pinterest expects
    if (isVideo) {
      // If we have a thumbnail/cover image, we'd add it here
      // For now, we'll let Pinterest auto-generate a thumbnail
      requestBody.media_source = {
        ...requestBody.media_source,
        // Set is_standard to true to use Pinterest's standard encoding
        is_standard: true,
      };
    }

    // Appel à l'API Pinterest
    const pinterestResponse = await fetch("https://api.pinterest.com/v5/pins", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
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
      postId: data.id,
      postUrl: `https://www.pinterest.com/pin/${data.id}/`,
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
