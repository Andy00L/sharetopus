// app/api/storage/generate-upload-url/route.ts
import { adminSupabase } from "@/actions/api/adminSupabase";
import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { STORAGE_LIMITS } from "@/lib/types/plans";
import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
// Helper function to get user's total file size
async function getUserTotalFileSize(userId: string, bucketName: string): Promise<number> {
  try {
    const { data: files, error } = await adminSupabase.storage
      .from(bucketName)
      .list(userId);

    if (error) {
      console.error("[Storage Check] Error listing files:", error);
      return 0;
    }

    const totalSize =
      files?.reduce((total, file) => {
        return total + (file.metadata?.size || 0);
      }, 0) || 0;

    return totalSize;
  } catch (error) {
    console.error("[Storage Check] Error calculating total size:", error);
    return 0;
  }
}

export async function POST(req: NextRequest) {
  try {
    // Get authenticated user
    const { userId } = await auth();

    if (!userId) {
      console.error("[Generate Upload URL] Authentication error: No userId");
      return NextResponse.json(
        {
          success: false,
          error: "Authentication required",
          message: "Please sign in to upload files.",
        },
        { status: 401 }
      );
    }

    const envBucket = process.env.SUPABASE_BUCKET_NAME;
    if (!envBucket) {
      console.error("[Generate Upload URL] SUPABASE_BUCKET_NAME not configured");
      return NextResponse.json(
        {
          success: false,
          error: "Server misconfiguration",
          message: "Upload service is not configured. Please contact support.",
        },
        { status: 500 }
      );
    }

    const body = await req.json();

    const {
      filename,
      contentType,
      fileSize,
      planId,
      isScheduled,
      bucketName = envBucket,
    } = body;

    if (!filename || !contentType || !fileSize) {
      console.error("[Generate Upload URL] Missing parameters:", {
        filename,
        contentType,
      });
      return NextResponse.json(
        {
          success: false,
          error: "Invalid upload request",
          message: "Please select a valid file and try again.",
        },
        { status: 400 }
      );
    }

    // Check subscription status
    const subscriptionCheck = await checkActiveSubscription(userId);
    if (!subscriptionCheck.success || !subscriptionCheck.isActive) {
      return NextResponse.json(
        { success: false, message: "Abonnement actif requis" },
        { status: 403 }
      );
    }

    // Check storage limits only for scheduled posts (files that stay in storage)
    if (isScheduled && planId && fileSize) {
      const storageLimit = STORAGE_LIMITS[planId];
      if (storageLimit) {
        const currentTotalSize = await getUserTotalFileSize(userId, bucketName);

        if (currentTotalSize + fileSize > storageLimit) {
          const limitInGB = storageLimit / (1024 * 1024 * 1024);

          return NextResponse.json(
            {
              success: false,
              error: "Storage limit exceeded",
              message: `This upload would exceed your ${limitInGB}GB storage limit. Please delete some Scheduled Posts or upgrade your plan to continue.`,
            },
            { status: 413 }
          );
        }
      }
    }

    // Generate a unique filename to avoid collisions
    const fileExtension = filename.split(".").pop() ?? "mp4";
    const uniqueFilename = `${randomUUID()}.${fileExtension}`;

    // Construct the path: user_id/unique_filename.ext
    const filePath = `${userId}/${uniqueFilename}`;

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
        {
          success: false,
          error: "Upload preparation failed",
          message: "We couldn't prepare your file upload. Please try again.",
        },
        { status: 500 }
      );
    }

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
        success: false,
        error: "Upload service error",
        message:
          "Something went wrong while preparing your upload. Please try again.",
      },
      { status: 500 }
    );
  }
}
