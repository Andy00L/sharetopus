import "server-only";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { x402PaidEndpoint } from "@/lib/x402/middleware/x402PaidEndpoint";
import { cancelScheduledPostBatch } from "@/actions/server/scheduleActions/cancel/cancelScheduledPostBatch";
import { preflightScheduledPostChange } from "@/actions/server/scheduleActions/preflightScheduledPostChange";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/x402/cancel
 *
 * Pays the cancel action (price per pricing_actions). Cancels 1-50
 * scheduled posts.
 * Steps:
 * 1. Parse body (post_ids array, 1-50 UUIDs).
 * 2. Before settlement, check the posts belong to the payer and at least one
 *    is still scheduled; a failure here costs nothing.
 * 3. x402 middleware handles payment and the charge.
 * 4. Call cancelScheduledPostBatch with createdVia="x402".
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

  resolveAction: () => ({ success: true, action: "cancel" }),

  precheck: ({ body, principal }) =>
    preflightScheduledPostChange({
      postIds: body.post_ids,
      principalId: principal.principalId,
      eligibleStatuses: ["scheduled"],
    }),

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
