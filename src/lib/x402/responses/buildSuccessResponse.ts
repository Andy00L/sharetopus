import "server-only";

import { NextResponse } from "next/server";
import type { RegisterSuccessPayload } from "@/lib/x402/register/types";
import { paymentResponseHeaders } from "@/lib/x402/http/paymentHttp";

/**
 * Builds a 200 OK NextResponse with the register success payload.
 *
 * When a new registration completes, the settlement details are returned in
 * the PAYMENT-RESPONSE header (plus the v1 X-PAYMENT-RESPONSE alias). For
 * idempotent retries (isNew=false), paymentResponseHeader is null because
 * nothing was settled.
 */
export function buildRegisterSuccessResponse(
  payload: RegisterSuccessPayload,
  paymentResponseHeader: string | null
): NextResponse {
  const headers: Record<string, string> = paymentResponseHeader
    ? paymentResponseHeaders(paymentResponseHeader)
    : {};
  return NextResponse.json(payload, { status: 200, headers });
}

/**
 * Generic 200 OK builder for x402 paid endpoint middleware.
 *
 * Body shape: { success: true, data, chargeId, network, txHash, payerAddress }
 * Sets PAYMENT-RESPONSE (and the v1 X-PAYMENT-RESPONSE alias) when provided.
 */
export function buildGenericSuccessResponse(params: {
  data: unknown;
  txHash: string;
  network: string;
  payerAddress: string;
  chargeId: string;
  paymentResponseHeader?: string | null;
}): NextResponse {
  const headers: Record<string, string> = params.paymentResponseHeader
    ? paymentResponseHeaders(params.paymentResponseHeader)
    : {};
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
