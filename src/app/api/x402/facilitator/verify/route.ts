import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { X402_FACILITATOR_VERIFY_RATE_LIMIT } from "@/actions/server/rateLimit/rateLimitRules";
import {
  readFacilitatorRequest,
  resolveFacilitatedNetwork,
} from "@/lib/x402/arc/facilitatorApi";
import {
  buildRateLimitJsonResponse,
  describeRateLimitRejection,
} from "@/lib/x402/http/rateLimitRejection";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rateLimitResult = await checkRateLimit({
    operation: "x402_facilitator_verify",
    identifier: null,
    rule: X402_FACILITATOR_VERIFY_RATE_LIMIT,
  });
  if (!rateLimitResult.success) {
    return buildRateLimitJsonResponse(describeRateLimitRejection(rateLimitResult));
  }

  const networkResult = resolveFacilitatedNetwork();
  if (!networkResult.ok) {
    return NextResponse.json(
      { error: "facilitator_unavailable", message: networkResult.message },
      { status: networkResult.httpStatus },
    );
  }

  const requestResult = await readFacilitatorRequest(
    request,
    networkResult.network,
  );
  if (!requestResult.ok) {
    // @x402/core's HTTPFacilitatorClient reads a VerifyResponse off a non-2xx body (dist/esm/chunk-W4OPBTK7.mjs).
    return NextResponse.json(
      {
        isValid: false,
        invalidReason: "invalid_request",
        invalidMessage: requestResult.message,
      },
      { status: requestResult.httpStatus },
    );
  }

  try {
    const verifyResponse = await networkResult.facilitator.verify(
      requestResult.paymentPayload,
      requestResult.paymentRequirements,
    );
    return NextResponse.json(verifyResponse, { status: 200 });
  } catch (err) {
    console.error(
      "[POST /api/x402/facilitator/verify] Verify threw:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      {
        isValid: false,
        invalidReason: "facilitator_error",
        invalidMessage: "Verification could not be completed.",
      },
      { status: 502 },
    );
  }
}
