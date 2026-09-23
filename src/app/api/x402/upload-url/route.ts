import "server-only";

import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  x402PaidEndpoint,
  x402ChallengeGet,
} from "@/lib/x402/middleware/x402PaidEndpoint";
import { enforceWalletStorageQuota } from "@/lib/x402/storage/enforceWalletStorageQuota";
import {
  checkUploadRequest,
  generateServerSignedUploadUrl,
} from "@/actions/server/data/generateServerSignedUploadUrl";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/x402/upload-url
 *
 * Pays the upload_url action (price per pricing_actions). Mints a signed
 * Supabase Storage upload URL.
 * Steps:
 * 1. Parse body (filename, content_type, size_bytes).
 * 2. Before settlement, check the content type, the per-file size cap and
 *    the wallet storage quota; a failure here costs nothing.
 * 3. x402 middleware handles payment and the charge.
 * 4. Mint the signed upload URL via generateServerSignedUploadUrl.
 *
 * The quota is checked against the declared size_bytes: a signed upload URL
 * cannot bind the size, so one upload can overshoot the cap by one file, up
 * to the storage bucket's own file size limit. The next request counts the
 * real stored bytes.
 */

/** x402 wallets have no plan tier; they get the default upload limits. */
const WALLET_UPLOAD_TIER = null;

const UploadUrlBodySchema = z.object({
  filename: z.string().min(1).max(255),
  content_type: z.string().min(1).max(255),
  size_bytes: z.number().int().positive().max(250 * 1024 * 1024), // 250 MB max
});

type UploadUrlBody = z.infer<typeof UploadUrlBodySchema>;

type UploadUrlResult = {
  uploadUrl: string;
  path: string;
};

// Challenge-only GET for A2MCP endpoint validation probes (curl -i expects
// the 402 challenge).
export const GET = x402ChallengeGet({
  endpointPath: "/api/x402/upload-url",
  action: "upload_url",
  rateLimitScope: "x402:upload-url",
  rateLimitPerMinute: 20,
});

export const POST = x402PaidEndpoint<UploadUrlBody, UploadUrlResult>({
  endpointPath: "/api/x402/upload-url",
  rateLimitScope: "x402:upload-url",
  rateLimitPerMinute: 20,
  defaultAction: "upload_url",

  parseBody: async (req: NextRequest) => {
    try {
      const json = await req.json();
      const parsed = UploadUrlBodySchema.safeParse(json);
      if (!parsed.success) {
        return {
          success: false,
          httpStatus: 400,
          errorKind: "validation_error",
          message: parsed.error.issues.map((issue) => issue.message).join("; "),
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

  precheck: async ({ body, principal }) => {
    const requestCheck = checkUploadRequest({
      contentType: body.content_type,
      fileSize: body.size_bytes,
      tier: WALLET_UPLOAD_TIER,
    });
    if (!requestCheck.ok) {
      return {
        ok: false,
        httpStatus: requestCheck.reason === "file_too_large" ? 413 : 415,
        errorKind: requestCheck.reason,
        message: requestCheck.message,
      };
    }

    const quotaResult = await enforceWalletStorageQuota(principal.principalId, body.size_bytes);
    if (!quotaResult.allowed) {
      return { ok: false, httpStatus: 413, errorKind: "quota_exceeded", message: quotaResult.message };
    }
    return { ok: true };
  },

  handler: async ({ body, principal }) => {
    // Re-checked after settlement: a concurrent upload can have used the
    // remaining quota since the precheck.
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

    // The wallet quota above replaces the plan-tier storage check.
    const uploadResult = await generateServerSignedUploadUrl({
      principalId: principal.principalId,
      tier: WALLET_UPLOAD_TIER,
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
