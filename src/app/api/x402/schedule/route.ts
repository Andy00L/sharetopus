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
import {
  preflightSchedulePost,
  schedulePostBatch,
} from "@/actions/server/scheduleActions/schedule/schedulePostBatch";
import { updateChargeRecord } from "@/lib/x402/charges/chargeLifecycle";
import type { PrivacyLevel } from "@/lib/types/dbTypes";
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
 * 3. Before settlement, check the post would be scheduled: fields, media
 *    path, caption length, account ownership, the platform's daily cap, an
 *    unused idempotency_key. A failure here costs nothing.
 * 4. On settle, call schedulePostBatch with createdVia="x402".
 * 5. Link x402_charges.scheduled_post_id to the inserted post.
 *
 * A scheduling failure after settlement is refunded on-chain; a post the
 * platform rejects later, at publish time, is not refunded.
 */

/**
 * TikTok privacy levels the scheduler accepts.
 * sourceRef: src/lib/types/dbTypes.ts (PrivacyLevel)
 */
const PRIVACY_LEVELS = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
  "PUBLIC",
  "PROTECTED",
] as const satisfies readonly PrivacyLevel[];

/**
 * Options the scheduler reads for the legacy platforms.
 * sourceRef: src/inngest/functions/processSinglePostHelpers.ts (PostOptions).
 * Unknown keys are stripped rather than rejected, so older clients that send
 * extras keep working, and every value is bounded before it is stored.
 */
const PostOptionsSchema = z.object({
  link: z.string().url().max(2048).optional(),
  board: z.string().max(128).optional(),
  boardName: z.string().max(200).optional(),
  privacyLevel: z.enum(PRIVACY_LEVELS).optional(),
  visibility: z.string().max(32).optional(),
  disableComment: z.boolean().optional(),
  disableDuet: z.boolean().optional(),
  disableStitch: z.boolean().optional(),
  brandContentToggle: z.boolean().optional(),
  yourBrand: z.boolean().optional(),
  brandedContent: z.boolean().optional(),
  isAigc: z.boolean().optional(),
  privacyStatus: z.enum(["public", "unlisted", "private"]).optional(),
});

const ScheduleBodySchema = withMediaPathRule(
  PostBodyBaseSchema.extend({
    scheduled_at: z.string().refine(
      (value) => {
        const date = new Date(value);
        return !isNaN(date.getTime()) && date.getTime() > Date.now();
      },
      { message: "scheduled_at must be a valid ISO 8601 date in the future." }
    ),
    post_options: PostOptionsSchema.nullable().optional(),
  })
);

type ScheduleBody = z.infer<typeof ScheduleBodySchema>;

type ScheduleResult = {
  batchId: string;
  scheduleIds: string[];
  inserted: number;
};

/** The single post this request pays for, as schedulePostBatch takes it. */
function toSchedulePostData(body: ScheduleBody, batchId: string): SchedulePostData {
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

  return {
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
}

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

  resolveAction: (body) => {
    const result = resolvePostAction(body.post_type);
    if (!result.success) return result;
    return { success: true, action: result.action };
  },

  // The batch id is irrelevant to the checks; a placeholder keeps the one
  // conversion function shared with the handler.
  precheck: ({ body, principal }) =>
    preflightSchedulePost(toSchedulePostData(body, "preflight"), principal.principalId),

  handler: async ({ body, principal, chargeId, requestId }) => {
    const scheduleResult = await schedulePostBatch(
      [toSchedulePostData(body, generateBatchId())],
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

    // The precheck rejects a used idempotency_key, but a concurrent request
    // can claim it in between; then nothing was scheduled for this payment.
    if (scheduleResult.details.inserted === 0) {
      return {
        success: false,
        errorKind: "duplicate_idempotency_key",
        message: "A post with this idempotency_key is already scheduled.",
        refundable: true,
      };
    }

    const scheduledPostId = scheduleResult.scheduleIds[0];
    if (scheduledPostId) {
      await updateChargeRecord(chargeId, { scheduledPostId });
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
