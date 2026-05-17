import "server-only";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { x402PaidEndpoint } from "@/lib/x402/middleware/x402PaidEndpoint";
import { deleteScheduledPostBatch } from "@/actions/server/scheduleActions/delete/deleteScheduledPostBatch";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/x402/delete
 *
 * Pays delete for $0.001 USDC. Hard deletes 1-50 scheduled/completed posts.
 * Steps:
 * 1. Parse body (post_ids array, 1-50 UUIDs).
 * 2. x402 middleware handles auth, payment, charge.
 * 3. Call deleteScheduledPostBatch with createdVia="x402".
 * 4. Return delete result.
 */

const DeleteBodySchema = z.object({
  post_ids: z.array(z.string().uuid()).min(1).max(50),
});

type DeleteBody = z.infer<typeof DeleteBodySchema>;

type DeleteResult = {
  succeeded: number;
  failed: number;
  mediaDeleted: number;
};

export const POST = x402PaidEndpoint<DeleteBody, DeleteResult>({
  endpointPath: "/api/x402/delete",
  rateLimitScope: "x402:delete",
  rateLimitPerMinute: 30,

  parseBody: async (req: NextRequest) => {
    try {
      const json = await req.json();
      const parsed = DeleteBodySchema.safeParse(json);
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

  resolveAction: () => ({ success: true, action: "delete" }),

  handler: async ({ body, principal, requestId }) => {
    const result = await deleteScheduledPostBatch(
      body.post_ids,
      principal.principalId,
      "x402",
      requestId,
    );

    if (!result.success) {
      return {
        success: false,
        errorKind: "execution_failed",
        message: result.message,
        refundable: true,
      };
    }

    return {
      success: true,
      data: {
        succeeded: result.details?.succeeded ?? 0,
        failed: result.details?.failed ?? 0,
        mediaDeleted: result.details?.mediaDeleted ?? 0,
      },
    };
  },
});
