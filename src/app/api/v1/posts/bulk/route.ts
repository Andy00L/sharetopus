import { NextResponse } from "next/server";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { restInputToSchedulePostData } from "@/lib/api/rest/adapters/restInputToScheduledPost";
import { toPostDTO } from "@/lib/api/rest/dto/toPostDTO";
import { PostBulkInputSchema } from "@/lib/api/rest/validation/postPatchSchemas";
import { schedulePostBatch } from "@/actions/server/scheduleActions/schedule/schedulePostBatch";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { generateBatchId } from "@/lib/utils/generateBatchId";

/**
 * POST /v1/posts/bulk -- schedule up to 30 posts in one call.
 *
 * Reuses schedulePostBatch (same function MCP bulk_schedule calls).
 * Each item goes through restInputToSchedulePostData for shape
 * translation. A shared batch_id groups all posts.
 */
export const POST = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.posts.bulk",
  handler: async (ctx, request) => {
    // Step 1: parse JSON body.
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return restErrorResponse(
        "validation_error",
        "Request body is not valid JSON",
        ctx.requestId,
      );
    }

    // Step 2: Zod validate the array.
    const validationResult = PostBulkInputSchema.safeParse(rawBody);
    if (!validationResult.success) {
      return restErrorResponse(
        "validation_error",
        "Request body failed validation",
        ctx.requestId,
        { issues: validationResult.error.issues },
      );
    }
    const validatedBulkInput = validationResult.data;

    // Step 3: generate a shared batch_id for the entire bulk request.
    const sharedBatchId = generateBatchId();

    // Step 4: transform each item to SchedulePostData with shared batch_id.
    const scheduledPostsData = validatedBulkInput.posts.map(
      (postInput, postIndex) => {
        const scheduleData = restInputToSchedulePostData(postInput);
        // Override batch_id so all posts in this bulk share one group.
        scheduleData.batch_id = sharedBatchId;
        // Build idempotency key from batch_id + index for safe retries.
        scheduleData.idempotency_key =
          postInput.idempotency_key ?? `${sharedBatchId}:${postIndex}`;
        return scheduleData;
      },
    );

    // Step 5: call schedulePostBatch (same function MCP uses).
    const batchResult = await schedulePostBatch(
      scheduledPostsData,
      ctx.principal.principalId,
      "api",
      ctx.requestId,
    );

    if (!batchResult.success) {
      return restErrorResponse(
        "internal_error",
        batchResult.message,
        ctx.requestId,
        { batch_id: sharedBatchId },
      );
    }

    // Step 6: fetch created rows to return as PostDTOs.
    const insertedIds = batchResult.scheduleIds ?? [];
    let postDtos: ReturnType<typeof toPostDTO>[] = [];

    if (insertedIds.length > 0) {
      const { data: insertedRows, error: fetchError } = await adminSupabase
        .from("scheduled_posts")
        .select("*")
        .in("id", insertedIds)
        .order("created_at", { ascending: true });

      if (fetchError) {
        console.error(
          `[v1/posts/bulk POST] row fetch failed (request_id=${ctx.requestId}):`,
          fetchError.message,
        );
      } else {
        postDtos = (insertedRows ?? []).map(toPostDTO);
      }
    }

    const responsePayload = {
      success: true,
      batch_id: sharedBatchId,
      total: batchResult.details.total,
      inserted: batchResult.details.inserted,
      duplicates: batchResult.details.duplicates,
      rejected: batchResult.details.rejected,
      posts: postDtos,
    };

    return {
      response: NextResponse.json(responsePayload, {
        status: 200,
        headers: { "x-request-id": ctx.requestId },
      }),
      auditSummary: {
        batch_id: sharedBatchId,
        total: batchResult.details.total,
        inserted: batchResult.details.inserted,
        duplicates: batchResult.details.duplicates,
        rejected_count: batchResult.details.rejected.length,
      },
    };
  },
});
