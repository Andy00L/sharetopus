import "server-only";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { x402PaidEndpoint } from "@/lib/x402/middleware/x402PaidEndpoint";
import { cancelScheduledPostBatch } from "@/actions/server/scheduleActions/cancel/cancelScheduledPostBatch";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/x402/cancel
 *
 * Pays cancel for $0.001 USDC. Cancels 1-50 scheduled posts.
 * Steps:
 * 1. Parse body (post_ids array, 1-50 UUIDs).
 * 2. x402 middleware handles auth, payment, charge.
 * 3. Call cancelScheduledPostBatch with createdVia="x402".
 * 4. Return cancel result.
 */

const CancelBodySchema = z.object({
  post_ids: z.array(z.string().uuid()).min(1).max(50),
});

type CancelBody = z.infer<typeof CancelBodySchema>;

type CancelResult = {
  succeeded: number;
  failed: number;
};

export const POST = x402PaidEndpoint<CancelBody, CancelResult>({
  endpointPath: "/api/x402/cancel",
  rateLimitScope: "x402:cancel",
  rateLimitPerMinute: 30,
  defaultAction: "cancel",

  parseBody: async (req: NextRequest) => {
    try {
      const json = await req.json();
      const parsed = CancelBodySchema.safeParse(json);
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

  resolveAction: () => ({ success: true, action: "cancel" }),

  handler: async ({ body, principal, requestId }) => {
    const result = await cancelScheduledPostBatch(
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
      },
    };
  },
});
