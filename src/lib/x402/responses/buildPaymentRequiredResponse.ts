import "server-only";

import { NextResponse } from "next/server";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";

/**
 * Builds a 402 Payment Required NextResponse.
 *
 * x402 v2 carries the requirements in the base64 PAYMENT-REQUIRED header;
 * the JSON body is non-normative, so the same PaymentRequired object is
 * emitted there too for humans and v1-era clients that read the body.
 *
 * Called by: x402PaidEndpoint, register/connect routes
 */
export function buildPaymentRequiredResponse(
  paymentRequired: PaymentRequired
): NextResponse {
  return NextResponse.json(paymentRequired, {
    status: 402,
    headers: {
      "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired),
    },
  });
}
