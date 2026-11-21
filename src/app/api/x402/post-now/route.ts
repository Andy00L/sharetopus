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
  withPostTypeRules,
} from "@/lib/x402/middleware/postBodySchema";
import {
  directPostBatch,
  preflightDirectPost,
} from "@/actions/server/directPostActions/directPostBatch";
import type { DirectPostData } from "@/actions/server/directPostActions/directPostBatch";

export const runtime = "nodejs";
export const maxDuration = 60;

const PostNowBodySchema = withPostTypeRules(PostBodyBaseSchema);

type PostNowBody = z.infer<typeof PostNowBodySchema>;

type PostNowResult = {
  batchId: string;
  eventIds: string[];
  dispatched: number;
};

function toDirectPostData(body: PostNowBody): DirectPostData {
  return {
    socialAccountId: body.social_account_id,
    platform: body.platform,
    postType: body.post_type,
    description: body.description,
    mediaStoragePath: body.media_storage_path ?? "",
    title: body.title ?? undefined,
    coverTimestamp: body.cover_timestamp,
    pinterestBoardId: body.pinterest_board_id,
    pinterestBoardName: body.pinterest_board_name,
    link: body.platform === "pinterest" ? body.pinterest_link : undefined,
    idempotency_key: body.idempotency_key,
  };
}

export const GET = x402ChallengeGet({
  endpointPath: "/api/x402/post-now",
  action: "post.text",
  rateLimitScope: "x402:post-now",
  rateLimitPerMinute: 20,
});

export const POST = x402PaidEndpoint<PostNowBody, PostNowResult>({
  endpointPath: "/api/x402/post-now",
  rateLimitScope: "x402:post-now",
  rateLimitPerMinute: 20,
  defaultAction: "post.text",

  parseBody: async (req: NextRequest) => {
    try {
      const json = await req.json();
      const parsed = PostNowBodySchema.safeParse(json);
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

  precheck: ({ body, principal }) =>
    preflightDirectPost(toDirectPostData(body), principal.principalId),

  handler: async ({ body, principal, requestId }) => {
    const batchResult = await directPostBatch(
      [toDirectPostData(body)],
      principal.principalId,
      "x402",
      undefined,
      requestId,
    );

    if (!batchResult.success) {
      return {
        success: false,
        errorKind: "execution_failed",
        message: batchResult.message,
      };
    }

    if (batchResult.details.dispatched === 0) {
      return {
        success: false,
        errorKind: "duplicate_idempotency_key",
        message: "A post with this idempotency_key was already dispatched.",
      };
    }

    return {
      success: true,
      data: {
        batchId: batchResult.batchId,
        eventIds: batchResult.eventIds,
        dispatched: batchResult.details.dispatched,
      },
      chargeRecord: { metadata: { batch_id: batchResult.batchId } },
    };
  },
});
