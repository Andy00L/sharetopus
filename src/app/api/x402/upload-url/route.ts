import "server-only";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { x402PaidEndpoint } from "@/lib/x402/middleware/x402PaidEndpoint";
import { enforceWalletStorageQuota } from "@/lib/x402/storage/enforceWalletStorageQuota";
import { generateServerSignedUploadUrl } from "@/actions/server/data/generateServerSignedUploadUrl";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/x402/upload-url
 *
 * Pays upload_url for $0.10 USDC. Mints a signed Supabase Storage upload URL.
 * Steps:
 * 1. Parse body (filename, content_type, size_bytes).
 * 2. x402 middleware handles auth, payment, charge.
 * 3. Enforce wallet storage quota via enforceWalletStorageQuota.
 * 4. Mint signed upload URL via generateServerSignedUploadUrl.
 * 5. Return signed URL + path.
 */

const UploadUrlBodySchema = z.object({
  filename: z.string().min(1).max(255),
  content_type: z.string().min(1),
  size_bytes: z.number().int().positive().max(250 * 1024 * 1024), // 250 MB max
});

type UploadUrlBody = z.infer<typeof UploadUrlBodySchema>;

type UploadUrlResult = {
  uploadUrl: string;
  path: string;
};

export const POST = x402PaidEndpoint<UploadUrlBody, UploadUrlResult>({
  endpointPath: "/api/x402/upload-url",
  rateLimitScope: "x402:upload-url",
  rateLimitPerMinute: 20,

  parseBody: async (req: NextRequest) => {
    try {
      const json = await req.json();
      const parsed = UploadUrlBodySchema.safeParse(json);
      if (!parsed.success) {
        return {
          success: false,
          httpStatus: 400,
          errorKind: "validation_error",
          message: parsed.error.issues.map((i) => i.message).join("; "),
        };
      }
      return { success: true, data: parsed.data };
    } catch {
      return {
        success: false,
        httpStatus: 400,
        errorKind: "invalid_json",
        message: "Request body must be valid JSON.",
      };
    }
  },

  resolveAction: () => ({ success: true, action: "upload_url" }),

  handler: async ({ body, principal }) => {
    // Enforce wallet-specific storage quota before minting URL.
    const quotaResult = await enforceWalletStorageQuota(
      principal.principalId,
      body.size_bytes,
    );

    if (!quotaResult.allowed) {
      return {
        success: false,
        errorKind: "quota_exceeded",
        message: quotaResult.message,
        refundable: true,
      };
    }

    // Mint signed upload URL. Skip internal quota check (already validated above).
    const uploadResult = await generateServerSignedUploadUrl({
      principalId: principal.principalId,
      tier: null,
      filename: body.filename,
      contentType: body.content_type,
      fileSize: body.size_bytes,
      countTowardStorage: false,
    });

    if (!uploadResult.success || !uploadResult.uploadUrl || !uploadResult.path) {
      return {
        success: false,
        errorKind: "upload_url_mint_failed",
        message: uploadResult.message,
        refundable: true,
      };
    }

    return {
      success: true,
      data: {
        uploadUrl: uploadResult.uploadUrl,
        path: uploadResult.path,
      },
    };
  },
});
