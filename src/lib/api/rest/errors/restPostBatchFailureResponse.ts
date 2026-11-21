import type { NextResponse } from "next/server";

import type {
  PostBatchFailure,
  PostChangeFailure,
  PostRejection,
  PostRejectionCode,
} from "@/lib/types/postBatch";

import {
  restErrorResponse,
  SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS,
  type RestErrorCode,
} from "./restErrorResponse";

const REJECTION_ERROR_CODES = {
  invalid_input: "validation_error",
  platform_mismatch: "validation_error",
  not_owned: "not_found",
} as const satisfies Record<PostRejectionCode, RestErrorCode>;

export function restPostBatchFailureResponse(
  batchResult: {
    failure: PostBatchFailure | PostChangeFailure;
    message: string;
    resetIn?: number;
    details?: { rejected: PostRejection[] };
  },
  requestId: string,
): NextResponse {
  switch (batchResult.failure) {
    case "rejected": {
      const rejected = batchResult.details?.rejected ?? [];
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
    case "not_found":
      return restErrorResponse("not_found", "Post not found", requestId);
    case "not_eligible":
      return restErrorResponse("conflict", batchResult.message, requestId);
    case "access_required":
      return restErrorResponse("forbidden", batchResult.message, requestId);
  }
}
