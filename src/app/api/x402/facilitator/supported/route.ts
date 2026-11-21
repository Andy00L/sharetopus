import "server-only";

import { NextResponse } from "next/server";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { X402_FACILITATOR_SUPPORTED_RATE_LIMIT } from "@/actions/server/rateLimit/rateLimitRules";
import {
  buildSupportedResponse,
  resolveFacilitatedNetwork,
} from "@/lib/x402/arc/facilitatorApi";
import {
  buildRateLimitJsonResponse,
  describeRateLimitRejection,
} from "@/lib/x402/http/rateLimitRejection";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(): Promise<NextResponse> {
  const rateLimitResult = await checkRateLimit({
    operation: "x402_facilitator_supported",
    identifier: null,
    rule: X402_FACILITATOR_SUPPORTED_RATE_LIMIT,
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

  return NextResponse.json(
    buildSupportedResponse(networkResult.network, networkResult.signerAddress),
    { status: 200 },
  );
}
