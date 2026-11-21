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
import { MEDIA_BUCKET } from "@/lib/storage/mediaBucket";
import type { PlanTier } from "@/lib/types/plans";
import { randomUUID } from "crypto";

const ALLOWED_UPLOAD_TYPES: ReadonlyArray<string> = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_VIDEO_TYPES,
];

export interface GenerateUploadUrlInput {
  principalId: string;
  tier: PlanTier | null;
  filename: string;
  contentType: string;
  fileSize: number;
  countTowardStorage: boolean;
}

export type GenerateUploadUrlReason =
  | "invalid_input"
  | "content_type_not_allowed"
  | "file_too_large"
  | "storage_quota_exceeded"
  | "supabase_error";

export type GenerateUploadUrlResult =
  | { success: true; message: string; uploadUrl: string; path: string; token: string }
  | { success: false; message: string; reason: GenerateUploadUrlReason };

export type UploadRequestCheck =
  | { ok: true }
  | { ok: false; reason: "content_type_not_allowed" | "file_too_large"; message: string };

export function checkUploadRequest(input: {
  contentType: string;
  fileSize: number;
  tier: PlanTier | null;
}): UploadRequestCheck {
  if (!ALLOWED_UPLOAD_TYPES.includes(input.contentType)) {
    return {
      ok: false,
      reason: "content_type_not_allowed",
      message: `Content type "${input.contentType}" is not allowed. Accepted: ${ALLOWED_UPLOAD_TYPES.join(", ")}.`,
    };
  }

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
      ok: false,
      reason: "file_too_large",
      message: `${mediaKind === "image" ? "Image" : "Video"} files are capped at ${capMB} MB on your plan.`,
    };
  }

  return { ok: true };
}

export async function generateServerSignedUploadUrl(
  input: GenerateUploadUrlInput
): Promise<GenerateUploadUrlResult> {
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

  const requestCheck = checkUploadRequest(input);
  if (!requestCheck.ok) {
    return { success: false, message: requestCheck.message, reason: requestCheck.reason };
  }

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

  const ext = (input.filename.split(".").pop() ?? "bin").toLowerCase();
  const filePath = `${input.principalId}/${randomUUID()}.${ext}`;

  try {
    const { data, error } = await adminSupabase.storage
      .from(MEDIA_BUCKET)
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
