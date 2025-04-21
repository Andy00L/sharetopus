// app/api/storage/generate-upload-url/route.ts
import { adminSupabase } from "@/actions/api/supabase-client";
import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
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

    // Get file information from request body
    let body;
    try {
      body = await req.json();
      console.log("[Generate Upload URL] Request body:", body);
    } catch (err) {
      console.error("[Generate Upload URL] Error parsing request body:", err);
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { filename, contentType, bucketName = "scheduled-videos" } = body;

    if (!filename || !contentType) {
      console.error("[Generate Upload URL] Missing parameters:", {
        filename,
        contentType,
      });
      return NextResponse.json(
        { error: "Missing required parameters: filename and contentType" },
        { status: 400 }
      );
    }

    // Generate a unique filename to avoid collisions
    const fileExtension = filename.split(".").pop() ?? "mp4";
    const uniqueFilename = `${randomUUID()}.${fileExtension}`;

    // Construct the path: user_id/unique_filename.ext
    const filePath = `${userId}/${uniqueFilename}`;

    console.log(
      `[Generate Upload URL] Creating signed URL for '${filePath}' in bucket '${bucketName}'`
    );
    console.log(`[Generate Upload URL] Content type: ${contentType}`);

    // Verify the bucket exists in Supabase
    try {
      const { data: buckets, error: bucketError } =
        await adminSupabase.storage.listBuckets();

      if (bucketError) {
        console.error(
          "[Generate Upload URL] Error listing buckets:",
          bucketError
        );
        return NextResponse.json(
          { error: `Failed to verify bucket: ${bucketError.message}` },
          { status: 500 }
        );
      }

      const bucketExists = buckets.some((b) => b.name === bucketName);

      if (!bucketExists) {
        console.error(`[Generate Upload URL] Bucket '${bucketName}' not found`);

        // Try to create the bucket
        try {
          const { error: createError } =
            await adminSupabase.storage.createBucket(bucketName, {
              public: false,
            });

          if (createError) {
            console.error(
              "[Generate Upload URL] Failed to create bucket:",
              createError
            );
            return NextResponse.json(
              {
                error: `Bucket does not exist and could not be created: ${createError.message}`,
              },
              { status: 500 }
            );
          }

          console.log(`[Generate Upload URL] Created bucket '${bucketName}'`);
        } catch (createErr) {
          console.error(
            "[Generate Upload URL] Error creating bucket:",
            createErr
          );
          return NextResponse.json(
            { error: "Bucket does not exist and could not be created" },
            { status: 500 }
          );
        }
      }
    } catch (listErr) {
      console.error("[Generate Upload URL] Error checking buckets:", listErr);
      // Continue anyway, since this might be a permissions issue rather than a real problem
    }

    // Generate a signed upload URL
    const { data, error } = await adminSupabase.storage
      .from(bucketName)
      .createSignedUploadUrl(filePath);

    if (error) {
      console.error(
        "[Generate Upload URL] Error generating signed URL:",
        error
      );
      return NextResponse.json(
        { error: `Failed to generate upload URL: ${error.message}` },
        { status: 500 }
      );
    }

    console.log("[Generate Upload URL] Success, returning:", {
      path: data.path,
      // Don't log the full URL for security
      signedUrlPartial: data.signedUrl.substring(0, 50) + "...",
      token: data.token ? "present" : "missing",
    });

    return NextResponse.json({
      success: true,
      uploadUrl: data.signedUrl,
      path: data.path,
      token: data.token,
    });
  } catch (err) {
    console.error("[Generate Upload URL] Unexpected error:", err);
    return NextResponse.json(
      {
        error: "Failed to generate upload URL",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
