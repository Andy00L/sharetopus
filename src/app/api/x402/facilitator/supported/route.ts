import "server-only";

import { NextResponse } from "next/server";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { loadArcOperationsAccount } from "@/lib/x402/arc/arcChain";
import {
  buildSupportedResponse,
  resolveFacilitatedNetwork,
} from "@/lib/x402/arc/facilitatorApi";

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
    return NextResponse.json(
      { error: "rate_limited", retryAfter: rateLimitResult.resetIn ?? 60 },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimitResult.resetIn ?? 60) },
      },
    );
  }

  const networkResult = resolveFacilitatedNetwork();
  if (!networkResult.ok) {
    return NextResponse.json(
      { error: "facilitator_unavailable", message: networkResult.message },
      { status: networkResult.httpStatus },
    );
  }

  // Resolved again rather than threaded through: resolveFacilitatedNetwork
  // already proved the key loads, so this cannot fail here.
  const accountResult = loadArcOperationsAccount();
  if (!accountResult.ok) {
    return NextResponse.json(
      { error: "facilitator_unavailable", message: accountResult.message },
      { status: 503 },
    );
  }

  return NextResponse.json(
    buildSupportedResponse(networkResult.network, accountResult.account.address),
    { status: 200 },
  );
}
