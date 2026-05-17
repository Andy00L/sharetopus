import "server-only";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { x402PaidEndpoint } from "@/lib/x402/middleware/x402PaidEndpoint";
import { resolvePostAction } from "@/lib/x402/middleware/resolvePostAction";
import { directPostBatch } from "@/actions/server/directPostActions/directPostBatch";
import type { DirectPostData } from "@/actions/server/directPostActions/directPostBatch";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/x402/post-now
 *
 * Pays post.text / post.image / post.video for $0.50-$1.00 USDC.
 * Steps:
 * 1. Parse body (Zod validates required fields).
 * 2. Resolve pricing action from post_type.
 * 3. x402 middleware handles auth, payment, charge, refund-on-fail.
 * 4. On settle, call directPostBatch with createdVia="x402".
 * 5. Return batch result + X-PAYMENT-RESPONSE header.
 */

const PostNowBodySchema = z.object({
  social_account_id: z.string().uuid(),
  platform: z.enum(["linkedin", "tiktok", "pinterest", "instagram"]),
  post_type: z.enum(["text", "image", "video"]),
  description: z.string().nullable(),
  media_storage_path: z.string().min(1).default(""),
  title: z.string().nullable().optional(),
  cover_timestamp: z.number().optional(),
  pinterest_board_id: z.string().optional(),
  pinterest_board_name: z.string().optional(),
  pinterest_link: z.string().optional(),
  idempotency_key: z.string().optional(),
});

type PostNowBody = z.infer<typeof PostNowBodySchema>;

type PostNowResult = {
  batchId: string;
  eventIds: string[];
  dispatched: number;
};

export const POST = x402PaidEndpoint<PostNowBody, PostNowResult>({
  endpointPath: "/api/x402/post-now",
  rateLimitScope: "x402:post-now",
  rateLimitPerMinute: 20,

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
      mediaStoragePath: body.media_storage_path,
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
