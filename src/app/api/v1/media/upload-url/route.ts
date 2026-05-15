import { NextResponse } from "next/server";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { UploadUrlInputSchema } from "@/lib/api/rest/validation/mediaSchemas";
import { generateServerSignedUploadUrl } from "@/actions/server/data/generateServerSignedUploadUrl";

const UPLOAD_URL_EXPIRY_SECONDS = 7200;

/**
 * POST /v1/media/upload-url -- request a signed upload URL.
 *
 * Reuses generateServerSignedUploadUrl (same helper web + MCP use).
 * Validates content type, per-file size cap, and storage quota.
 */
export const POST = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.media.upload_url",
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
    const validationResult = UploadUrlInputSchema.safeParse(rawBody);
    if (!validationResult.success) {
      return restErrorResponse(
        "validation_error",
        "Request body failed validation",
        ctx.requestId,
        { issues: validationResult.error.issues },
      );
    }
    const validatedInput = validationResult.data;

    // Step 3: delegate to shared helper (handles content type, size cap, quota).
    const uploadResult = await generateServerSignedUploadUrl({
      principalId: ctx.principal.principalId,
      tier: ctx.principal.plan,
      filename: validatedInput.filename,
      contentType: validatedInput.content_type,
      fileSize: validatedInput.size_bytes,
      countTowardStorage: true,
    });

    if (!uploadResult.success) {
      // Map helper reason to REST error code.
      const errorCode =
        uploadResult.reason === "storage_quota_exceeded"
          ? "forbidden"
          : uploadResult.reason === "file_too_large" ||
              uploadResult.reason === "content_type_not_allowed" ||
              uploadResult.reason === "invalid_input"
            ? "validation_error"
            : "internal_error";

      return restErrorResponse(
        errorCode,
        uploadResult.message,
        ctx.requestId,
      );
    }

    return {
      response: NextResponse.json(
        {
          upload_url: uploadResult.uploadUrl,
          storage_path: uploadResult.path,
          token: uploadResult.token,
          expires_in_seconds: UPLOAD_URL_EXPIRY_SECONDS,
        },
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        storage_path: uploadResult.path,
        expires_in_seconds: UPLOAD_URL_EXPIRY_SECONDS,
      },
    };
  },
});
