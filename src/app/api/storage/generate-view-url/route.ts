import { adminSupabase } from "@/actions/api/adminSupabase";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { path, expiresIn } = await request.json();

    if (!path || !expiresIn) {
      return NextResponse.json(
        { success: false, error: "Path is required" },
        { status: 400 }
      );
    }

    console.log("[Generate Upload URL]", path);

    // Generate signed URL
    const { data, error } = await adminSupabase.storage
      .from("scheduled-videos")
      .createSignedUrl(path, expiresIn);

    if (error) {
      console.error("Error generating signed URL:", error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }
    return NextResponse.json({
      success: true,
      url: data.signedUrl,
    });
  } catch (error) {
    console.error("Error in generate-view-url:", error);
    return NextResponse.json(
      {
        success: false,
      },
      { status: 500 }
    );
  }
}
