import { NextResponse } from "next/server";

export type RestErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_error"
  | "rate_limited"
  | "internal_error";

const HTTP_STATUS_BY_CODE: Record<RestErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_error: 400,
  rate_limited: 429,
  internal_error: 500,
};

/**
 * Standard REST error response. Always carries request_id for
 * support correlation. Does NOT include DB error messages, stack
 * traces, or internal field names. Server-side log includes detail.
 */
export function restErrorResponse(
  code: RestErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
      request_id: requestId,
    },
    {
      status: HTTP_STATUS_BY_CODE[code],
      headers: {
        "x-request-id": requestId,
      },
    },
  );
}
