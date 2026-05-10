// app/api/storage/generate-upload-url/route.ts
import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import {
  generateServerSignedUploadUrl,
  type GenerateUploadUrlReason,
} from "@/actions/server/data/generateServerSignedUploadUrl";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const REASON_TO_STATUS: Record<GenerateUploadUrlReason, number> = {
  missing_bucket_env: 500,
  invalid_input: 400,
  content_type_not_allowed: 400,
  file_too_large: 413,
  storage_quota_exceeded: 413,
  supabase_error: 500,
};

export async function POST(req: NextRequest) {
  try {
    // 1. Clerk auth
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

    // 2. Parse body (same shape as before for backward compat)
    const body = await req.json();
    const { filename, contentType, fileSize, isScheduled, bucketName } = body;

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

    // 3. Subscription check
    const subscriptionCheck = await checkActiveSubscription(userId);
    if (!subscriptionCheck.success || !subscriptionCheck.isActive) {
      return NextResponse.json(
        { success: false, message: "Abonnement actif requis" },
        { status: 403 }
      );
    }

    // 4. Delegate to shared helper
    const result = await generateServerSignedUploadUrl({
      principalId: userId,
      priceId: subscriptionCheck.plan ?? null,
      filename,
      contentType,
      fileSize,
      countTowardStorage: isScheduled === true,
      bucketName,
    });

    if (!result.success) {
      const status = result.reason
        ? REASON_TO_STATUS[result.reason]
        : 500;
      console.error(
        `[Generate Upload URL] Helper rejected: ${result.reason} -- ${result.message}`
      );
      return NextResponse.json(
        {
          success: false,
          error: result.message,
          message: result.message,
        },
        { status }
      );
    }

    // 5. Success (same response shape as before)
    return NextResponse.json({
      success: true,
      uploadUrl: result.uploadUrl,
      path: result.path,
      token: result.token,
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
