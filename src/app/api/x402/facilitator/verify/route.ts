import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import {
  readFacilitatorRequest,
  resolveFacilitatedNetwork,
} from "@/lib/x402/arc/facilitatorApi";
import {
  buildRateLimitJsonResponse,
  describeRateLimitRejection,
} from "@/lib/x402/http/rateLimitRejection";

/**
 * POST /api/x402/facilitator/verify
 * Body: { x402Version, paymentPayload, paymentRequirements }
 *
 * Checks an EIP-3009 authorization against the caller's requirements: the
 * signature, the authorization nonce still being unused on-chain, the
 * validity window, and the payer's balance. Open, because verifying only
 * reads the chain and costs no gas.
 *
 * Logic lives in src/lib/x402/arc/facilitatorApi.ts and the scheme itself
 * in src/lib/x402/arc/arcFacilitator.ts.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rateLimitResult = await checkRateLimit(
    "x402_facilitator_verify",
    null,
    60,
    60,
  );
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
    // The x402 client reads isValid off an error body, so the protocol's own
    // failure shape goes back rather than a bare message it cannot parse.
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
