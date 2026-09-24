import type { NextResponse } from "next/server";

import type {
  PostBatchFailure,
  PostRejection,
  PostRejectionCode,
} from "@/lib/types/postBatch";

import {
  restErrorResponse,
  SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS,
  type RestErrorCode,
} from "./restErrorResponse";

/**
 * The REST error code for each reason a post is refused. Another
 * principal's account answers 404, as every REST route does for resources
 * the caller cannot see.
 */
const REJECTION_ERROR_CODES = {
  invalid_input: "validation_error",
  platform_mismatch: "validation_error",
  not_owned: "not_found",
} as const satisfies Record<PostRejectionCode, RestErrorCode>;

/**
 * The REST answer for a failed post batch (directPostBatch or
 * schedulePostBatch). A client mistake gets the 4xx it can act on instead
 * of a 500, and a check that could not run gets a 503 with a retry hint.
 * Batch messages never carry database errors, so each is safe to return.
 *
 * Called by: POST /v1/posts and POST /v1/posts/bulk
 */
export function restPostBatchFailureResponse(
  batchResult: {
    failure: PostBatchFailure;
    message: string;
    resetIn?: number;
    details: { rejected: PostRejection[] };
  },
  requestId: string,
): NextResponse {
  const { rejected } = batchResult.details;
  switch (batchResult.failure) {
    case "rejected": {
      const [firstRejection] = rejected;
      return restErrorResponse(
        firstRejection ? REJECTION_ERROR_CODES[firstRejection.code] : "validation_error",
        firstRejection?.reason ?? batchResult.message,
        requestId,
        { rejected },
      );
    }
    case "invalid_request":
      return restErrorResponse("validation_error", batchResult.message, requestId);
    case "unauthenticated":
      return restErrorResponse("unauthorized", batchResult.message, requestId);
    case "rate_limited":
      return restErrorResponse("rate_limited", batchResult.message, requestId, {
        retry_after_seconds: batchResult.resetIn ?? null,
      });
    case "quota_exceeded":
      return restErrorResponse("rate_limited", batchResult.message, requestId);
    case "unavailable":
      return restErrorResponse("service_unavailable", batchResult.message, requestId, {
        retry_after_seconds: SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS,
      });
    case "internal":
      return restErrorResponse("internal_error", batchResult.message, requestId);
  }
}
