import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
} from "@/components/core/create/constants/constants";
import {
  TIER_UPLOAD_LIMITS,
  DEFAULT_UPLOAD_LIMITS,
} from "@/components/core/create/constants/uploadLimits";
import { enforceStorageQuota } from "@/lib/mcp/_shared/enforceStorageQuota";
import type { PlanTier } from "@/lib/types/plans";
import { randomUUID } from "crypto";

/**
 * Content types accepted for upload. Built from the shared constants
 * plus "video/quicktime" (alias for .mov that some agents send).
 */
const ALLOWED_UPLOAD_TYPES: ReadonlyArray<string> = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_VIDEO_TYPES,
  "video/quicktime",
];

export interface GenerateUploadUrlInput {
  principalId: string;
  tier: PlanTier | null;
  filename: string;
  contentType: string;
  fileSize: number;
  countTowardStorage: boolean;
  bucketName?: string;
}

export type GenerateUploadUrlReason =
  | "missing_bucket_env"
  | "invalid_input"
  | "content_type_not_allowed"
  | "file_too_large"
  | "storage_quota_exceeded"
  | "supabase_error";

export interface GenerateUploadUrlResult {
  success: boolean;
  message: string;
  uploadUrl?: string;
  path?: string;
  token?: string;
  reason?: GenerateUploadUrlReason;
}

/**
 * Server-side helper that validates an upload request and mints a
 * Supabase signed upload URL.
 *
 * Transport-agnostic: the caller provides principalId + priceId.
 * Does NOT perform auth or subscription checks.
 *
 * Used by:
 *   - src/app/api/storage/generate-upload-url/route.ts (web uploads)
 *   - src/lib/mcp/tools/requestUploadUrl.ts (MCP tool)
 *
 * Validation order:
 *   1. Input fields present and valid
 *   2. Bucket env configured
 *   3. Content type in allow-list
 *   4. Per-file size cap (from TIER_UPLOAD_LIMITS)
 *   5. Storage quota (via enforceStorageQuota RPC, when countTowardStorage)
 *   6. Mint signed upload URL via adminSupabase
 */
export async function generateServerSignedUploadUrl(
  input: GenerateUploadUrlInput
): Promise<GenerateUploadUrlResult> {
  // 1. Validate inputs
  if (
    !input.principalId ||
    !input.filename ||
    !input.contentType ||
    input.fileSize <= 0
  ) {
    return {
      success: false,
      message:
        "Missing or invalid upload parameters (principalId, filename, contentType, or fileSize).",
      reason: "invalid_input",
    };
  }

  // 2. Resolve bucket
  const bucket = input.bucketName ?? process.env.SUPABASE_BUCKET_NAME;
  if (!bucket) {
    console.error(
      "[generateServerSignedUploadUrl] SUPABASE_BUCKET_NAME not configured"
    );
    return {
      success: false,
      message: "Upload service is not configured. Please contact support.",
      reason: "missing_bucket_env",
    };
  }

  // 3. Validate content type
  if (!ALLOWED_UPLOAD_TYPES.includes(input.contentType)) {
    return {
      success: false,
      message: `Content type "${input.contentType}" is not allowed. Accepted: ${ALLOWED_UPLOAD_TYPES.join(", ")}.`,
      reason: "content_type_not_allowed",
    };
  }

  // 4. Per-file size cap (image vs video, per-tier)
  const mediaKind: "image" | "video" = input.contentType.startsWith("image/")
    ? "image"
    : "video";
  const limits = input.tier !== null
    ? TIER_UPLOAD_LIMITS[input.tier]
    : DEFAULT_UPLOAD_LIMITS;
  const capMB = mediaKind === "image" ? limits.image : limits.video;
  const capBytes = capMB * 1024 * 1024;

  if (input.fileSize > capBytes) {
    return {
      success: false,
      message: `${mediaKind === "image" ? "Image" : "Video"} files are capped at ${capMB} MB on your plan.`,
      reason: "file_too_large",
    };
  }

  // 5. Aggregate storage quota (RPC-based, accurate for any file count)
  if (input.countTowardStorage) {
    const check = await enforceStorageQuota(
      input.principalId,
      input.tier,
      input.fileSize,
    );
    if (!check.success) {
      return {
        success: false,
        message: check.message,
        reason: "storage_quota_exceeded",
      };
    }
  }

  // 6. Build path: principalId/uuid.ext
  const ext = (input.filename.split(".").pop() ?? "bin").toLowerCase();
  const filePath = `${input.principalId}/${randomUUID()}.${ext}`;

  // 7. Create signed upload URL
  try {
    const { data, error } = await adminSupabase.storage
      .from(bucket)
      .createSignedUploadUrl(filePath);

    if (error) {
      console.error(
        "[generateServerSignedUploadUrl] Supabase error:",
        error.message
      );
      return {
        success: false,
        message: "Failed to prepare upload. Please try again.",
        reason: "supabase_error",
      };
    }

    return {
      success: true,
      message: "ok",
      uploadUrl: data.signedUrl,
      path: data.path,
      token: data.token,
    };
  } catch (err) {
    console.error(
      "[generateServerSignedUploadUrl] Unexpected error:",
      err instanceof Error ? err.message : err
    );
    return {
      success: false,
      message: "Failed to prepare upload. Please try again.",
      reason: "supabase_error",
    };
  }
}
