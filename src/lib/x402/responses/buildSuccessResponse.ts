import "server-only";

import { NextResponse } from "next/server";
import type { RegisterSuccessPayload } from "@/lib/x402/register/types";

/**
 * Builds a 200 OK NextResponse with the register success payload.
 *
 * When a new registration completes, the X-PAYMENT-RESPONSE header is set
 * to the base64-encoded SettleResponse from the facilitator. For idempotent
 * retries (isNew=false), paymentResponseHeader is null (no settlement).
 */
export function buildSuccessResponse(
  payload: RegisterSuccessPayload,
  paymentResponseHeader: string | null
): NextResponse {
  const headers: Record<string, string> = {};
  if (paymentResponseHeader) {
    headers["X-PAYMENT-RESPONSE"] = paymentResponseHeader;
  }
  return NextResponse.json(payload, { status: 200, headers });
}
