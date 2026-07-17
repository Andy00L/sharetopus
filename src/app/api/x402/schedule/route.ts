import "server-only";

import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  x402PaidEndpoint,
  x402ChallengeGet,
} from "@/lib/x402/middleware/x402PaidEndpoint";
import { resolvePostAction } from "@/lib/x402/middleware/resolvePostAction";
import {
  PostBodyBaseSchema,
  withMediaPathRule,
} from "@/lib/x402/middleware/postBodySchema";
import { schedulePostBatch } from "@/actions/server/scheduleActions/schedule/schedulePostBatch";
import { adminSupabase } from "@/actions/api/adminSupabase";
import type { SchedulePostData } from "@/lib/types/SchedulePostData";
import { generateBatchId } from "@/lib/utils/generateBatchId";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/x402/schedule
 *
 * Pays post.text / post.image / post.video (price per pricing_actions).
 * Steps:
 * 1. Parse body (shared posting schema + scheduled_at in the future).
 * 2. Resolve pricing action from post_type.
 * 3. x402 middleware handles auth, payment, charge, refund-on-fail.
 * 4. On settle, call schedulePostBatch with createdVia="x402".
 * 5. Link x402_charges.scheduled_post_id to the inserted post.
 * 6. Return schedule result + PAYMENT-RESPONSE header.
 */

const ScheduleBodySchema = withMediaPathRule(
  PostBodyBaseSchema.extend({
    scheduled_at: z.string().refine(
      (val) => {
        const date = new Date(val);
        return !isNaN(date.getTime()) && date.getTime() > Date.now();
      },
      { message: "scheduled_at must be a valid ISO 8601 date in the future." }
    ),
    post_options: z.record(z.string(), z.unknown()).nullable().optional(),
  })
);

type ScheduleBody = z.infer<typeof ScheduleBodySchema>;

type ScheduleResult = {
  batchId: string;
  scheduleIds: string[];
  inserted: number;
};

// Challenge-only GET for A2MCP endpoint validation probes (curl -i expects
// the 402 challenge). post.text is the representative price for the probe.
export const GET = x402ChallengeGet({
  endpointPath: "/api/x402/schedule",
  action: "post.text",
  rateLimitScope: "x402:schedule",
  rateLimitPerMinute: 10,
});

export const POST = x402PaidEndpoint<ScheduleBody, ScheduleResult>({
  endpointPath: "/api/x402/schedule",
  rateLimitScope: "x402:schedule",
  rateLimitPerMinute: 10,
  defaultAction: "post.text",

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

    // Pinterest board fields can arrive with or without a post_options
    // object; either way they must reach the scheduler.
    const hasPinterestFields =
      body.pinterest_board_id !== undefined ||
      body.pinterest_board_name !== undefined ||
      body.pinterest_link !== undefined;
    const postOptions =
      body.post_options || hasPinterestFields
        ? {
            board: body.pinterest_board_id,
            boardName: body.pinterest_board_name,
            link: body.pinterest_link,
            ...(body.post_options ?? {}),
          }
        : null;

    // Build SchedulePostData from the validated body.
    const schedulePost: SchedulePostData = {
      socialAccountId: body.social_account_id,
      platform: body.platform,
      scheduledAt: body.scheduled_at,
      postType: body.post_type,
      description: body.description,
      mediaStoragePath: body.media_storage_path ?? "",
      title: body.title ?? undefined,
      coverTimestamp: body.cover_timestamp,
      batch_id: batchId,
      postOptions,
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
      const { error: linkError } = await adminSupabase
        .from("x402_charges")
        .update({ scheduled_post_id: scheduleResult.scheduleIds[0] })
        .eq("id", chargeId);
      if (linkError) {
        // Best-effort linkage: the post and the charge both exist, only the
        // FK back-reference is missing, which reporting can rebuild.
        console.error(`[POST /api/x402/schedule] Failed to link charge ${chargeId} to post ${scheduleResult.scheduleIds[0]}: ${linkError.message}`);
      }
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
