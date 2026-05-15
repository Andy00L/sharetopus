import { NextResponse } from "next/server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { AttachFromUrlInputSchema } from "@/lib/api/rest/validation/mediaSchemas";
import { safeUserFetch } from "@/lib/mcp/_shared/safeUserFetch";
import { getUploadLimitsForPrincipal } from "@/lib/mcp/_shared/getUploadLimitsForPrincipal";
import { enforceStorageQuota } from "@/lib/mcp/_shared/enforceStorageQuota";

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

/**
 * POST /v1/media/attach-from-url -- download from URL and upload to storage.
 *
 * Orchestrates the same pure helpers as the MCP attach_media_from_url tool:
 * safeUserFetch (SSRF guard + download), getUploadLimitsForPrincipal (size caps),
 * enforceStorageQuota (quota check), adminSupabase.storage.upload (persist).
 */
export const POST = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.media.attach_from_url",
  handler: async (ctx, request) => {
    // Step 1: parse JSON body.
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

    // Step 2: Zod validate.
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

    // Step 3: resolve per-tier upload size caps (MB -> bytes).
    const uploadLimits = getUploadLimitsForPrincipal(ctx.principal.plan);
    const maxFetchBytes =
      Math.max(uploadLimits.image, uploadLimits.video) * 1024 * 1024;

    // Step 4: fetch with SSRF guard + streaming size limit.
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

    // Step 5: type-specific size cap (image vs video).
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

    // Step 6: aggregate storage quota check (after download, before upload).
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

    // Step 7: determine filename and upload path.
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(validatedInput.url);
    } catch {
      parsedUrl = new URL("https://unknown/media");
    }
    const urlBasename = parsedUrl.pathname.split("/").pop() ?? "media";
    const fallbackExt = isVideo ? ".mp4" : ".jpg";
    const resolvedFilename =
      validatedInput.filename ??
      (urlBasename.includes(".") ? urlBasename : `${urlBasename}${fallbackExt}`);
    const storagePath = `${ctx.principal.principalId}/${Date.now()}_${resolvedFilename}`;

    // Step 8: upload to Supabase storage.
    const { error: uploadError } = await adminSupabase.storage
      .from("scheduled-videos")
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
        },
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
