import { adminSupabase } from "@/actions/api/adminSupabase";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const ViewUrlBodySchema = z.object({
  path: z.string().min(1).max(2048),
  expiresIn: z.coerce.number().int().min(1).max(3600).default(300),
});

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

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Request body is not valid JSON" },
        { status: 400 }
      );
    }

    const parseResult = ViewUrlBodySchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body", issues: parseResult.error.issues },
        { status: 400 }
      );
    }
    const { path, expiresIn } = parseResult.data;

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
