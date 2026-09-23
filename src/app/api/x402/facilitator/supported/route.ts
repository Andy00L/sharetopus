import "server-only";

import { NextResponse } from "next/server";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import {
  buildSupportedResponse,
  resolveFacilitatedNetwork,
} from "@/lib/x402/arc/facilitatorApi";
import {
  buildRateLimitJsonResponse,
  describeRateLimitRejection,
} from "@/lib/x402/http/rateLimitRejection";

/**
 * GET /api/x402/facilitator/supported
 *
 * What this facilitator will verify and settle: the exact scheme on Arc
 * mainnet, plus the address that broadcasts settlements. Open, because it
 * only reads configuration.
 *
 * Logic lives in src/lib/x402/arc/facilitatorApi.ts.
 */

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(): Promise<NextResponse> {
  const rateLimitResult = await checkRateLimit(
    "x402_facilitator_supported",
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

  return NextResponse.json(
    buildSupportedResponse(networkResult.network, networkResult.signerAddress),
    { status: 200 },
  );
}
