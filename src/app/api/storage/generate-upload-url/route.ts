import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import {
  generateServerSignedUploadUrl,
  type GenerateUploadUrlReason,
} from "@/actions/server/data/generateServerSignedUploadUrl";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const REASON_TO_STATUS: Record<GenerateUploadUrlReason, number> = {
  invalid_input: 400,
  content_type_not_allowed: 400,
  file_too_large: 413,
  storage_quota_exceeded: 413,
  supabase_error: 500,
};

const UploadUrlRequestSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  fileSize: z.number().positive(),
  isScheduled: z.boolean().optional(),
});

type UploadUrlRequestRead =
  | { ok: true; uploadRequest: z.infer<typeof UploadUrlRequestSchema> }
  | { ok: false; reason: "body_not_json" | "fields_invalid" };

async function readUploadUrlRequest(req: NextRequest): Promise<UploadUrlRequestRead> {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return { ok: false, reason: "body_not_json" };
  }
  const parseResult = UploadUrlRequestSchema.safeParse(rawBody);
  return parseResult.success
    ? { ok: true, uploadRequest: parseResult.data }
    : { ok: false, reason: "fields_invalid" };
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      console.error("[POST] Authentication error: No userId");
      return NextResponse.json(
        {
          success: false,
          error: "Authentication required",
          message: "Please sign in to upload files.",
        },
        { status: 401 }
      );
    }

    const requestRead = await readUploadUrlRequest(req);
    if (!requestRead.ok) {
      console.error(
        `[POST] Invalid upload request from user ${userId}: ${requestRead.reason}`,
      );
      return NextResponse.json(
        {
          success: false,
          error: "Invalid upload request",
          message: "Please select a valid file and try again.",
        },
        { status: 400 }
      );
    }

    // A failed subscription read is ours: 503 and a retry,
    // never a "subscription required" to a paying user.
    const subscriptionCheck = await checkActiveSubscription(userId);
    if (subscriptionCheck.status === "unavailable") {
      return NextResponse.json(
        {
          success: false,
          error: "Subscription check failed",
          message: "Could not check your subscription. Please try again.",
        },
        { status: 503 }
      );
    }
    if (!subscriptionCheck.isActive) {
      return NextResponse.json(
        {
          success: false,
          error: "Subscription required",
          message: "An active subscription is required to upload files.",
        },
        { status: 403 }
      );
    }

    const { filename, contentType, fileSize, isScheduled } =
      requestRead.uploadRequest;
    const result = await generateServerSignedUploadUrl({
      principalId: userId,
      tier: subscriptionCheck.tier,
      filename,
      contentType,
      fileSize,
      countTowardStorage: isScheduled === true,
    });

    if (!result.success) {
      const status = result.reason
        ? REASON_TO_STATUS[result.reason]
        : 500;
      console.error(
        `[POST] Helper rejected: ${result.reason} -- ${result.message}`
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

    return NextResponse.json({
      success: true,
      uploadUrl: result.uploadUrl,
      path: result.path,
      token: result.token,
    });
  } catch (err) {
    console.error("[POST] Unexpected error:", err);
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
