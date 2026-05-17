import "server-only";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { x402PaidEndpoint } from "@/lib/x402/middleware/x402PaidEndpoint";
import { resolvePostAction } from "@/lib/x402/middleware/resolvePostAction";
import { schedulePostBatch } from "@/actions/server/scheduleActions/schedule/schedulePostBatch";
import { adminSupabase } from "@/actions/api/adminSupabase";
import type { SchedulePostData } from "@/lib/types/SchedulePostData";
import { generateBatchId } from "@/lib/utils/generateBatchId";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/x402/schedule
 *
 * Pays post.text / post.image / post.video for $0.50-$1.00 USDC.
 * Steps:
 * 1. Parse body (validates required fields + scheduled_at is in the future).
 * 2. Resolve pricing action from post_type.
 * 3. x402 middleware handles auth, payment, charge, refund-on-fail.
 * 4. On settle, call schedulePostBatch with createdVia="x402".
 * 5. Link x402_charges.scheduled_post_id to the inserted post.
 * 6. Return schedule result + X-PAYMENT-RESPONSE header.
 */

const ScheduleBodySchema = z.object({
  social_account_id: z.string().uuid(),
  platform: z.enum(["linkedin", "tiktok", "pinterest", "instagram"]),
  post_type: z.enum(["text", "image", "video"]),
  description: z.string().nullable(),
  media_storage_path: z.string().min(1).default(""),
  scheduled_at: z.string().refine(
    (val) => {
      const date = new Date(val);
      return !isNaN(date.getTime()) && date.getTime() > Date.now();
    },
    { message: "scheduled_at must be a valid ISO 8601 date in the future." }
  ),
  title: z.string().nullable().optional(),
  cover_timestamp: z.number().optional(),
  pinterest_board_id: z.string().optional(),
  pinterest_board_name: z.string().optional(),
  pinterest_link: z.string().optional(),
  post_options: z.record(z.string(), z.unknown()).nullable().optional(),
  idempotency_key: z.string().optional(),
});

type ScheduleBody = z.infer<typeof ScheduleBodySchema>;

type ScheduleResult = {
  batchId: string;
  scheduleIds: string[];
  inserted: number;
};

export const POST = x402PaidEndpoint<ScheduleBody, ScheduleResult>({
  endpointPath: "/api/x402/schedule",
  rateLimitScope: "x402:schedule",
  rateLimitPerMinute: 10,

  parseBody: async (req: NextRequest) => {
    try {
      const json = await req.json();
      const parsed = ScheduleBodySchema.safeParse(json);
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

  resolveAction: (body) => {
    const result = resolvePostAction(body.post_type);
    if (!result.success) return result;
    return { success: true, action: result.action };
  },

  handler: async ({ body, principal, chargeId, requestId }) => {
    const batchId = generateBatchId();

    // Build SchedulePostData from validated body.
    const schedulePost: SchedulePostData = {
      socialAccountId: body.social_account_id,
      platform: body.platform,
      scheduledAt: body.scheduled_at,
      postType: body.post_type,
      description: body.description,
      mediaStoragePath: body.media_storage_path,
      title: body.title ?? undefined,
      coverTimestamp: body.cover_timestamp,
      batch_id: batchId,
      postOptions: body.post_options ? {
        board: body.pinterest_board_id,
        boardName: body.pinterest_board_name,
        link: body.pinterest_link,
        ...body.post_options,
      } : null,
      idempotency_key: body.idempotency_key,
    };

    const scheduleResult = await schedulePostBatch(
      [schedulePost],
      principal.principalId,
      "x402",
      requestId,
    );

    if (!scheduleResult.success) {
      return {
        success: false,
        errorKind: "execution_failed",
        message: scheduleResult.message,
        refundable: true,
      };
    }

    // Wire x402_charges.scheduled_post_id back to the inserted post.
    if (scheduleResult.scheduleIds.length > 0) {
      await adminSupabase
        .from("x402_charges")
        .update({ scheduled_post_id: scheduleResult.scheduleIds[0] })
        .eq("id", chargeId);
    }

    return {
      success: true,
      data: {
        batchId: scheduleResult.batchId,
        scheduleIds: scheduleResult.scheduleIds,
        inserted: scheduleResult.details.inserted,
      },
    };
  },
});
