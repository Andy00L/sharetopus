import { adminSupabase } from "@/actions/api/adminSupabase";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      console.error("[generate-view-url] Authentication error: No userId");
      return NextResponse.json(
        {
          success: false,
          error: "Authentication required",
        },
        { status: 401 }
      );
    }

    const { path, expiresIn } = await request.json();

    if (!path || !expiresIn) {
      return NextResponse.json(
        { success: false, error: "Path is required" },
        { status: 400 }
      );
    }

    if (!path.startsWith(`${userId}/`)) {
      console.warn(
        `[generate-view-url] Access denied: user ${userId} tried to access ${path}`
      );
      return NextResponse.json(
        {
          success: false,
          error: "Access denied: path does not belong to authenticated user",
        },
        { status: 403 }
      );
    }

    console.log(`[generate-view-url] Auth ok for user ${userId}, path: ${path}`);

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
