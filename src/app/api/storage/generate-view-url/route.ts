import { adminSupabase } from "@/actions/api/supabase-client";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const { userId } = await auth();

    if (!userId) {
      console.error("[Generate Upload URL] Authentication error: No userId");
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 }
      );
    }
    const { path, expiresIn = 1800 } = await request.json(); // Default 30 minutes

    if (!path) {
      return NextResponse.json(
        { success: false, error: "Path is required" },
        { status: 400 }
      );
    }

    // Create Supabase client

    // Get the bucket name from the path (format: "bucket/path/to/file")
    const bucketName = "scheduled-videos";
    console.log(path);
    // Generate signed URL
    const { data, error } = await adminSupabase.storage
      .from(bucketName)
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
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
