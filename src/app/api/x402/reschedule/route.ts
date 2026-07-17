import "server-only";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { x402PaidEndpoint } from "@/lib/x402/middleware/x402PaidEndpoint";
import { updateScheduledTimeBatch } from "@/actions/server/scheduleActions/reschedule/updateScheduledTimeBatch";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/x402/reschedule
 *
 * Pays reschedule for $0.10 USDC. Changes the scheduled_at of one post.
 * Steps:
 * 1. Parse body (post_id, new_scheduled_time).
 * 2. x402 middleware handles auth, payment, charge.
 * 3. Call updateScheduledTimeBatch with createdVia="x402".
 * 4. Return reschedule result.
 */

const RescheduleBodySchema = z.object({
  post_id: z.string().uuid(),
  new_scheduled_time: z.string().refine(
    (val) => {
      const date = new Date(val);
      return !isNaN(date.getTime()) && date.getTime() > Date.now();
    },
    { message: "new_scheduled_time must be a valid ISO 8601 date in the future." }
  ),
});

type RescheduleBody = z.infer<typeof RescheduleBodySchema>;

type RescheduleResult = {
  succeeded: number;
  resumed: number;
};

export const POST = x402PaidEndpoint<RescheduleBody, RescheduleResult>({
  endpointPath: "/api/x402/reschedule",
  rateLimitScope: "x402:reschedule",
  rateLimitPerMinute: 30,
  defaultAction: "reschedule",

  parseBody: async (req: NextRequest) => {
    try {
      const json = await req.json();
      const parsed = RescheduleBodySchema.safeParse(json);
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

  resolveAction: () => ({ success: true, action: "reschedule" }),

  handler: async ({ body, principal, requestId }) => {
    const result = await updateScheduledTimeBatch(
      [body.post_id],
      body.new_scheduled_time,
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
        resumed: result.details?.resumedCount ?? 0,
      },
    };
  },
});
