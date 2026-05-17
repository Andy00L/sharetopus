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
export function buildRegisterSuccessResponse(
  payload: RegisterSuccessPayload,
  paymentResponseHeader: string | null
): NextResponse {
  const headers: Record<string, string> = {};
  if (paymentResponseHeader) {
    headers["X-PAYMENT-RESPONSE"] = paymentResponseHeader;
  }
  return NextResponse.json(payload, { status: 200, headers });
}

/**
 * Generic 200 OK builder for x402 paid endpoint middleware.
 *
 * Body shape: { success: true, data, chargeId, network, txHash, payerAddress }
 * Sets X-PAYMENT-RESPONSE header when provided.
 */
export function buildGenericSuccessResponse(params: {
  data: unknown;
  txHash: string;
  network: string;
  payerAddress: string;
  chargeId: string;
  paymentResponseHeader?: string | null;
}): NextResponse {
  const headers: Record<string, string> = {};
  if (params.paymentResponseHeader) {
    headers["X-PAYMENT-RESPONSE"] = params.paymentResponseHeader;
  }
  return NextResponse.json(
    {
      success: true,
      data: params.data,
      chargeId: params.chargeId,
      network: params.network,
      txHash: params.txHash,
      payerAddress: params.payerAddress,
    },
    { status: 200, headers }
  );
}
