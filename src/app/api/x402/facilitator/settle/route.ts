import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { X402_FACILITATOR_SETTLE_RATE_LIMIT } from "@/actions/server/rateLimit/rateLimitRules";
import {
  checkSettleAccess,
  readFacilitatorRequest,
  resolveFacilitatedNetwork,
} from "@/lib/x402/arc/facilitatorApi";
import {
  buildRateLimitJsonResponse,
  describeRateLimitRejection,
} from "@/lib/x402/http/rateLimitRejection";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rateLimitResult = await checkRateLimit({
    operation: "x402_facilitator_settle",
    identifier: null,
    rule: X402_FACILITATOR_SETTLE_RATE_LIMIT,
  });
  if (!rateLimitResult.success) {
    return buildRateLimitJsonResponse(describeRateLimitRejection(rateLimitResult));
  }

  const accessResult = checkSettleAccess(request);
  if (!accessResult.ok) {
    return NextResponse.json(
      { error: "settle_forbidden", message: accessResult.message },
      { status: accessResult.httpStatus },
    );
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
    return NextResponse.json(
      {
        success: false,
        errorReason: "invalid_request",
        errorMessage: requestResult.message,
        transaction: "",
        network: networkResult.network.caipNetwork,
      },
      { status: requestResult.httpStatus },
    );
  }

  try {
    const settleResponse = await networkResult.facilitator.settle(
      requestResult.paymentPayload,
      requestResult.paymentRequirements,
    );
    return NextResponse.json(settleResponse, { status: 200 });
  } catch (err) {
    console.error(
      "[POST /api/x402/facilitator/settle] Settle threw:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      {
        success: false,
        errorReason: "facilitator_error",
        errorMessage: "Settlement could not be completed.",
        transaction: "",
        network: networkResult.network.caipNetwork,
      },
      { status: 502 },
    );
  }
}
