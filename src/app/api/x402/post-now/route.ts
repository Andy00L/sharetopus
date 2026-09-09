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
import { directPostBatch } from "@/actions/server/directPostActions/directPostBatch";
import type { DirectPostData } from "@/actions/server/directPostActions/directPostBatch";
import { adminSupabase } from "@/actions/api/adminSupabase";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/x402/post-now
 *
 * Pays post.text / post.image / post.video (price per pricing_actions).
 * Steps:
 * 1. Parse body (shared posting schema; media path required for image/video).
 * 2. Resolve pricing action from post_type.
 * 3. x402 middleware handles auth, payment, charge, refund-on-fail.
 * 4. On settle, call directPostBatch with createdVia="x402".
 * 5. Store the batch id on the charge (metadata.batch_id) so the settlement
 *    can be matched to its outcome later.
 * 6. Return batch result + PAYMENT-RESPONSE header.
 */

const PostNowBodySchema = withMediaPathRule(PostBodyBaseSchema);

type PostNowBody = z.infer<typeof PostNowBodySchema>;

type PostNowResult = {
  batchId: string;
  eventIds: string[];
  dispatched: number;
};

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
    // Build DirectPostData from the validated body.
    const directPost: DirectPostData = {
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

    const batchResult = await directPostBatch(
      [directPost],
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

    // Remember which batch this charge paid for. The post itself is created
    // asynchronously by the post.now consumer and keyed by batch_id
    // (content_history on success, failed_posts on failure), so this is the
    // only link between a settlement and its outcome. Best-effort, like the
    // scheduled_post_id wiring in /schedule: money and post both exist, only
    // the back-reference would be missing. metadata is otherwise unused on
    // x402_charges (insertPendingX402Charge never sets it), so a plain
    // replace is safe.
    const { error: linkError } = await adminSupabase
      .from("x402_charges")
      .update({ metadata: { batch_id: batchResult.batchId } })
      .eq("id", chargeId);
    if (linkError) {
      console.error(
        `[POST /api/x402/post-now] Failed to link charge ${chargeId} to batch ${batchResult.batchId}: ${linkError.message}`,
      );
    }

    return {
      success: true,
      data: {
        batchId: batchResult.batchId,
        eventIds: batchResult.eventIds,
        dispatched: batchResult.details.dispatched,
      },
    };
  },
});
