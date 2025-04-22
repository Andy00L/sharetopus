import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const {
      accessToken,
      boardId,
      title,
      description,
      link,
      base64Image,
      mediaType,
    } = await request.json();

    // Vérification des paramètres requis
    if (!accessToken || !boardId || !title || !base64Image) {
      console.log("big erreur");
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

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
          source_type: "image_base64",
          content_type: mediaType,
          data: base64Image,
        },
      }),
    });
    console.log(pinterestResponse);
    if (!pinterestResponse.ok) {
      const error = await pinterestResponse.json();
      return NextResponse.json({ error }, { status: pinterestResponse.status });
    }

    const data = await pinterestResponse.json();
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Failed to post to Pinterest:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
