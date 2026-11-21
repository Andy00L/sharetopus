import "server-only";

import { NextResponse } from "next/server";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";

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
