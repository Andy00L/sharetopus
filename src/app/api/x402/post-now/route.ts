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
  directPostBatch,
  preflightDirectPost,
} from "@/actions/server/directPostActions/directPostBatch";
import type { DirectPostData } from "@/actions/server/directPostActions/directPostBatch";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/x402/post-now
 *
 * Pays post.text / post.image / post.video (price per pricing_actions).
 * Steps:
 * 1. Parse body (shared posting schema; media path required for image/video).
 * 2. Resolve pricing action from post_type.
 * 3. Before settlement, check the post would dispatch: fields, media path,
 *    account ownership, platform match, unused idempotency_key. A failure
 *    here costs nothing.
 * 4. On settle, call directPostBatch with createdVia="x402".
 * 5. The batch id is stored on the charge (metadata.batch_id), the only
 *    link between a settlement and the post it paid for.
 *
 * Publishing runs asynchronously after the dispatch. A dispatch failure is
 * refunded on-chain; a post the platform rejects later, at publish time, is
 * not refunded.
 */

const PostNowBodySchema = withMediaPathRule(PostBodyBaseSchema);

type PostNowBody = z.infer<typeof PostNowBodySchema>;

type PostNowResult = {
  batchId: string;
  eventIds: string[];
  dispatched: number;
};

/** The single post this request pays for, as directPostBatch takes it. */
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
    pinterestLink: body.pinterest_link,
    idempotency_key: body.idempotency_key,
  };
}

// Challenge-only GET for A2MCP endpoint validation probes (curl -i expects
// the 402 challenge). post.text is the representative price for the probe.
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
        refundable: true,
      };
    }

    // The precheck rejects a used idempotency_key, but a concurrent request
    // can claim it in between; then nothing was dispatched for this payment.
    if (batchResult.details.dispatched === 0) {
      return {
        success: false,
        errorKind: "duplicate_idempotency_key",
        message: "A post with this idempotency_key was already dispatched.",
        refundable: true,
      };
    }

    return {
      success: true,
      data: {
        batchId: batchResult.batchId,
        eventIds: batchResult.eventIds,
        dispatched: batchResult.details.dispatched,
      },
      chargeMetadata: { batch_id: batchResult.batchId },
    };
  },
});
