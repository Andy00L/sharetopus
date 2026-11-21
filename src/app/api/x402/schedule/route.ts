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
  SchedulePostOptionsSchema,
  withPostTypeRules,
} from "@/lib/x402/middleware/postBodySchema";
import {
  preflightSchedulePost,
  schedulePostBatch,
} from "@/actions/server/scheduleActions/schedule/schedulePostBatch";
import type { SchedulePostData } from "@/lib/types/SchedulePostData";
import { generateBatchId } from "@/lib/utils/generateBatchId";

export const runtime = "nodejs";
export const maxDuration = 60;

const ScheduleBodySchema = withPostTypeRules(
  PostBodyBaseSchema.extend({
    scheduled_at: z.string().refine(
      (value) => {
        const date = new Date(value);
        return !isNaN(date.getTime()) && date.getTime() > Date.now();
      },
      { message: "scheduled_at must be a valid ISO 8601 date in the future." }
    ),
    post_options: SchedulePostOptionsSchema.nullable().optional(),
  })
);

type ScheduleBody = z.infer<typeof ScheduleBodySchema>;

type ScheduleResult = {
  batchId: string;
  scheduleIds: string[];
  inserted: number;
};

function toScheduleCandidate(body: ScheduleBody): Omit<SchedulePostData, "batch_id"> {
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
    postOptions,
    idempotency_key: body.idempotency_key,
  };
}

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

  precheck: ({ body, principal }) => preflightSchedulePost(toScheduleCandidate(body), principal.principalId),

  handler: async ({ body, principal, requestId }) => {
    const scheduleResult = await schedulePostBatch(
      [{ ...toScheduleCandidate(body), batch_id: generateBatchId() }],
      principal.principalId,
      "x402",
      requestId,
    );

    if (!scheduleResult.success) {
      return {
        success: false,
        errorKind: "execution_failed",
        message: scheduleResult.message,
      };
    }

    if (scheduleResult.details.inserted === 0) {
      return {
        success: false,
        errorKind: "duplicate_idempotency_key",
        message: "A post with this idempotency_key is already scheduled.",
      };
    }

    const scheduledPostId = scheduleResult.scheduleIds[0];
    return {
      success: true,
      data: {
        batchId: scheduleResult.batchId,
        scheduleIds: scheduleResult.scheduleIds,
        inserted: scheduleResult.details.inserted,
      },
      chargeRecord: scheduledPostId ? { scheduledPostId } : undefined,
    };
  },
});
