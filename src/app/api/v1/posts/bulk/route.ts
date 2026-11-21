import { asc, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { restPostBatchFailureResponse } from "@/lib/api/rest/errors/restPostBatchFailureResponse";
import { restInputToSchedulePostData } from "@/lib/api/rest/adapters/restInputToScheduledPost";
import { toPostDTO } from "@/lib/api/rest/dto/toPostDTO";
import type { PostBulkResult } from "@/lib/api/rest/openapi/responseSchemas";
import { PostBulkInputSchema } from "@/lib/api/rest/validation/postPatchSchemas";
import { schedulePostBatch } from "@/actions/server/scheduleActions/schedule/schedulePostBatch";
import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";
import { generateBatchId } from "@/lib/utils/generateBatchId";

export const POST = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.posts.bulk",
  handler: async (ctx, request) => {
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

    const sharedBatchId = generateBatchId();

    const scheduledPostsData = validatedBulkInput.posts.map(
      (postInput, postIndex) => {
        const scheduleData = restInputToSchedulePostData(postInput);
        scheduleData.batch_id = sharedBatchId;
        scheduleData.idempotency_key =
          postInput.idempotency_key ?? `${sharedBatchId}:${postIndex}`;
        return scheduleData;
      },
    );

    const batchResult = await schedulePostBatch(
      scheduledPostsData,
      ctx.principal.principalId,
      "api",
      ctx.requestId,
    );

    if (!batchResult.success) {
      return restPostBatchFailureResponse(batchResult, ctx.requestId);
    }

    const insertedIds = batchResult.scheduleIds ?? [];
    let postDtos: ReturnType<typeof toPostDTO>[] = [];

    if (insertedIds.length > 0) {
      const { data: insertedRows, error: fetchError } = await runQuery(
        db
          .select()
          .from(scheduled_posts)
          .where(inArray(scheduled_posts.id, insertedIds))
          .orderBy(asc(scheduled_posts.created_at)),
      );

      if (fetchError) {
        console.error(
          `[v1/posts/bulk POST] row fetch failed (request_id=${ctx.requestId}):`,
          fetchError.message,
        );
      } else {
        postDtos = insertedRows.map(toPostDTO);
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
    } satisfies PostBulkResult;

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
