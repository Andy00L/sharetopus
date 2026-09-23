import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import {
  checkSettleAccess,
  readFacilitatorRequest,
  resolveFacilitatedNetwork,
} from "@/lib/x402/arc/facilitatorApi";
import {
  buildRateLimitJsonResponse,
  describeRateLimitRejection,
} from "@/lib/x402/http/rateLimitRejection";

/**
 * POST /api/x402/facilitator/settle
 * Body: { x402Version, paymentPayload, paymentRequirements }
 * Header: X-API-Key
 *
 * Broadcasts the payer's EIP-3009 authorization on Arc. Gas comes out of
 * this operator's own USDC, so unlike /verify this one is gated: a settle
 * key is issued by hand, and with none configured the endpoint is closed.
 * Anyone can run their own copy instead (src/lib/x402/arc).
 *
 * Logic lives in src/lib/x402/arc/facilitatorApi.ts and the scheme itself
 * in src/lib/x402/arc/arcFacilitator.ts.
 */

export const runtime = "nodejs";
// Settlement waits for a receipt; Arc confirms in seconds, 60 is the ceiling.
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rateLimitResult = await checkRateLimit(
    "x402_facilitator_settle",
    null,
    30,
    60,
  );
  if (!rateLimitResult.success) {
    return buildRateLimitJsonResponse(describeRateLimitRejection(rateLimitResult));
  }

  // Checked before the body is read: an unauthorized caller learns nothing
  // about what this facilitator would have made of their payload.
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
