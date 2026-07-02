import "server-only";

import { NextResponse } from "next/server";
import { paymentResponseHeaders } from "@/lib/x402/http/paymentHttp";

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
