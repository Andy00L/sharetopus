import { NextResponse } from "next/server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { AttachFromUrlInputSchema } from "@/lib/api/rest/validation/mediaSchemas";
import type { MediaAttachResult } from "@/lib/api/rest/openapi/responseSchemas";
import { buildAttachedMediaPath } from "@/lib/mcp/_shared/buildAttachedMediaPath";
import { safeUserFetch } from "@/lib/mcp/_shared/safeUserFetch";
import { getUploadLimitsForPrincipal } from "@/lib/mcp/_shared/getUploadLimitsForPrincipal";
import { enforceStorageQuota } from "@/lib/mcp/_shared/enforceStorageQuota";
import { MEDIA_BUCKET } from "@/lib/storage/mediaBucket";

const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
];

const ALLOWED_CONTENT_TYPE_PREFIXES = ["image/", "video/"];

export const POST = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.media.attach_from_url",
  handler: async (ctx, request) => {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return restErrorResponse(
        "validation_error",
        "Request body is not valid JSON",
        ctx.requestId,
      );
    }

    const validationResult = AttachFromUrlInputSchema.safeParse(rawBody);
    if (!validationResult.success) {
      return restErrorResponse(
        "validation_error",
        "Request body failed validation",
        ctx.requestId,
        { issues: validationResult.error.issues },
      );
    }
    const validatedInput = validationResult.data;

    const uploadLimits = getUploadLimitsForPrincipal(ctx.principal.plan);
    const maxFetchBytes =
      Math.max(uploadLimits.image, uploadLimits.video) * 1024 * 1024;

    const fetchResult = await safeUserFetch(validatedInput.url, {
      maxBytes: maxFetchBytes,
      allowedContentTypePrefixes: ALLOWED_CONTENT_TYPE_PREFIXES,
      allowedContentTypes: ALLOWED_CONTENT_TYPES,
      connectTimeoutMs: 5_000,
      totalTimeoutMs: 30_000,
    });

    if (!fetchResult.success) {
      return restErrorResponse(
        "validation_error",
        fetchResult.message,
        ctx.requestId,
      );
    }

    const isVideo = fetchResult.contentType.startsWith("video/");
    const specificCapMb = isVideo ? uploadLimits.video : uploadLimits.image;
    const specificCapBytes = specificCapMb * 1024 * 1024;
    if (fetchResult.bytes.length > specificCapBytes) {
      return restErrorResponse(
        "validation_error",
        `File too large: ${Math.round(fetchResult.bytes.length / 1024 / 1024)} MB. ` +
          `${isVideo ? "Video" : "Image"} limit is ${specificCapMb} MB.`,
        ctx.requestId,
      );
    }

    const quotaResult = await enforceStorageQuota(
      ctx.principal.principalId,
      ctx.principal.plan,
      fetchResult.bytes.length,
    );
    if (!quotaResult.success) {
      const errorCode =
        quotaResult.reason === "quota_exceeded"
          ? "forbidden"
          : "internal_error";
      return restErrorResponse(
        errorCode,
        quotaResult.message,
        ctx.requestId,
      );
    }

    const storagePath = buildAttachedMediaPath(
      ctx.principal.principalId,
      fetchResult.contentType,
    );

    const { error: uploadError } = await adminSupabase.storage
      .from(MEDIA_BUCKET)
      .upload(storagePath, fetchResult.bytes, {
        contentType: fetchResult.contentType,
        upsert: false,
      });

    if (uploadError) {
      console.error(
        `[v1/media/attach-from-url POST] upload failed (request_id=${ctx.requestId}):`,
        uploadError.message,
      );
      return restErrorResponse(
        "internal_error",
        "Storage upload failed",
        ctx.requestId,
      );
    }

    return {
      response: NextResponse.json(
        {
          success: true,
          storage_path: storagePath,
          content_type: fetchResult.contentType,
          size_bytes: fetchResult.bytes.length,
        } satisfies MediaAttachResult,
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        storage_path: storagePath,
        content_type: fetchResult.contentType,
        size_bytes: fetchResult.bytes.length,
      },
    };
  },
});
