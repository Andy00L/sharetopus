import "server-only";

import { NextResponse } from "next/server";

/**
 * Generic error response builder for x402 paid endpoint middleware.
 *
 * Body shape: { success: false, error: errorKind, message, ...extras }
 * Supports optional refund metadata in the body.
 */
export function buildGenericErrorResponse(params: {
  httpStatus: number;
  errorKind: string;
  message: string;
  retryAfterSeconds?: number;
  refundInitiated?: boolean;
  refundTxHash?: string | null;
  chargeId?: string | null;
}): NextResponse {
  const headers: Record<string, string> = {};
  if (params.retryAfterSeconds !== undefined) {
    headers["Retry-After"] = String(params.retryAfterSeconds);
  }

  const body: Record<string, unknown> = {
    success: false,
    error: params.errorKind,
    message: params.message,
  };

  if (params.refundInitiated !== undefined) {
    body.refundInitiated = params.refundInitiated;
  }
  if (params.refundTxHash !== undefined) {
    body.refundTxHash = params.refundTxHash;
  }
  if (params.chargeId !== undefined) {
    body.chargeId = params.chargeId;
  }

  return NextResponse.json(body, { status: params.httpStatus, headers });
}
