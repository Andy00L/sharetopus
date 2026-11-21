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

const WALLET_UPLOAD_TIER = null;

const MAX_UPLOAD_SIZE_BYTES = 250 * 1024 * 1024;

const UploadUrlBodySchema = z.object({
  filename: z.string().min(1).max(255),
  content_type: z.string().min(1).max(255),
  size_bytes: z.number().int().positive().max(MAX_UPLOAD_SIZE_BYTES),
});

type UploadUrlBody = z.infer<typeof UploadUrlBodySchema>;

type UploadUrlResult = {
  uploadUrl: string;
  path: string;
};

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
    const quotaResult = await enforceWalletStorageQuota(
      principal.principalId,
      body.size_bytes,
    );
    if (!quotaResult.allowed) {
      return {
        success: false,
        errorKind: "quota_exceeded",
        message: quotaResult.message,
      };
    }

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
