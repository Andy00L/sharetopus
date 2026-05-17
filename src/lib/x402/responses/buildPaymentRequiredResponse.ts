import "server-only";

import { NextResponse } from "next/server";
import type { PaymentRequiredChallengeBody } from "@/lib/x402/register/handleRegisterChallenge";

/**
 * Builds a 402 Payment Required NextResponse with the challenge body.
 *
 * Status: 402
 * Headers: Content-Type: application/json
 * Body: PaymentRequiredChallengeBody (x402 V2 spec with extensions field)
 */
export function buildPaymentRequiredResponse(
  body: PaymentRequiredChallengeBody
): NextResponse {
  return NextResponse.json(body, { status: 402 });
}
