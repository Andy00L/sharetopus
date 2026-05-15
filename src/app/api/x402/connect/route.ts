import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { extractIpHash, extractUserAgent } from "@/lib/api/context";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";

import { getNetworkConfig, getDefaultNetwork } from "@/lib/x402/networks";
import { logX402Call } from "@/lib/x402/audit/logX402Call";
import { handleConnectChallenge } from "@/lib/x402/connect/handleConnectChallenge";
import { handleConnectVerify } from "@/lib/x402/connect/handleConnectVerify";
import type { ConnectVerifyError } from "@/lib/x402/connect/handleConnectVerify";
import { buildPaymentRequiredResponse } from "@/lib/x402/responses/buildPaymentRequiredResponse";
import type { ConnectNetworkContext, Platform } from "@/lib/x402/connect/types";
import type { WalletPrincipal } from "@/lib/x402/auth/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ENDPOINT_PATH = "/api/x402/connect";

const VALID_PLATFORMS = new Set<Platform>([
  "linkedin",
  "tiktok",
  "pinterest",
  "instagram",
]);

/**
 * POST /api/x402/connect?platform=linkedin
 *
 * x402 paid OAuth initiation. $0.50 USDC per new connection.
 *
 * Flow:
 *   - If no X-PAYMENT header: return 402 challenge
 *   - If X-PAYMENT present: verify payment, settle, create pending
 *     connection, return OAuth URL + token
 *
 * Query params:
 *   ?platform=linkedin|tiktok|pinterest|instagram (required)
 *   ?network=base-sepolia (optional, defaults to base mainnet)
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const startMs = performance.now();
  const ipHash = await extractIpHash();
  const userAgent = await extractUserAgent();

  // -- Parse platform query param
  const url = new URL(request.url);
  const platformParam = url.searchParams.get("platform");

  if (!platformParam || !VALID_PLATFORMS.has(platformParam as Platform)) {
    await logX402Call({
      principal: null,
      action: "connect_account",
      endpoint: ENDPOINT_PATH,
      chargeId: null,
      resultStatus: "error",
      latencyMs: Math.round(performance.now() - startMs),
      ipHash,
      userAgent,
    });
    return NextResponse.json(
      {
        error: "invalid_platform",
        message:
          "Query param ?platform is required. Supported: linkedin, tiktok, pinterest, instagram.",
      },
      { status: 400 }
    );
  }

  const platform = platformParam as Platform;

  // -- Resolve network
  const networkParam = url.searchParams.get("network");
  const network = networkParam
    ? getNetworkConfig(networkParam) ?? getDefaultNetwork()
    : getDefaultNetwork();

  // -- Build network context
  const recipientAddress = network.isEvm
    ? process.env.X402_RECIPIENT_EVM
    : process.env.X402_RECIPIENT_SOLANA;

  if (!recipientAddress) {
    console.error(`[POST /api/x402/connect] Recipient address env not set for ${network.name}`);
    await logX402Call({
      principal: null,
      action: "connect_account",
      endpoint: ENDPOINT_PATH,
      chargeId: null,
      resultStatus: "error",
      latencyMs: Math.round(performance.now() - startMs),
      ipHash,
      userAgent,
    });
    return NextResponse.json(
      { error: "internal", message: "Server misconfiguration." },
      { status: 500 }
    );
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ?? "https://sharetopus.com";
  const expectedDomain = new URL(baseUrl).host;
  const resourceUrl = `${baseUrl}${ENDPOINT_PATH}`;

  const context: ConnectNetworkContext = {
    network,
    recipientAddress,
    expectedDomain,
    resourceUrl,
    platform,
  };

  // -- Check for X-PAYMENT header
  const paymentHeader = request.headers.get("x-payment");

  if (!paymentHeader) {
    // -- Challenge path
    const rateLimitResult = await checkRateLimit(
      "x402_connect_challenge",
      null,
      10,
      60
    );
    if (!rateLimitResult.success) {
      await logX402Call({
        principal: null,
        action: "connect_account",
        endpoint: ENDPOINT_PATH,
        chargeId: null,
        resultStatus: "rate_limited",
        latencyMs: Math.round(performance.now() - startMs),
        ipHash,
        userAgent,
      });
      return NextResponse.json(
        {
          error: "rate_limited",
          retryAfter: rateLimitResult.resetIn ?? 60,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimitResult.resetIn ?? 60),
          },
        }
      );
    }

    const result = await handleConnectChallenge(context, platform);
    if (!result.ok) {
      console.error(`[POST /api/x402/connect] Challenge build failed: ${result.message}`);
      await logX402Call({
        principal: null,
        action: "connect_account",
        endpoint: ENDPOINT_PATH,
        chargeId: null,
        resultStatus: "error",
        latencyMs: Math.round(performance.now() - startMs),
        ipHash,
        userAgent,
      });
      return NextResponse.json(
        { error: "internal", message: result.message },
        { status: 500 }
      );
    }

    await logX402Call({
      principal: null,
      action: "connect_account",
      endpoint: ENDPOINT_PATH,
      chargeId: null,
      resultStatus: "402_required",
      latencyMs: Math.round(performance.now() - startMs),
      ipHash,
      userAgent,
    });

    return buildPaymentRequiredResponse(result.challengeBody);
  }

  // -- Verify path
  const result = await handleConnectVerify(
    request,
    paymentHeader,
    context,
    ipHash
  );

  if (!result.ok) {
    const auditStatus = mapErrorToAuditStatus(result.error);

    await logX402Call({
      principal: null,
      action: "connect_account",
      endpoint: ENDPOINT_PATH,
      chargeId: null,
      resultStatus: auditStatus,
      latencyMs: Math.round(performance.now() - startMs),
      ipHash,
      userAgent,
    });

    return buildConnectErrorResponse(result.error);
  }

  // -- Success
  const walletPrincipal: WalletPrincipal | null = null; // Principal is resolved inside handleConnectVerify

  await logX402Call({
    principal: walletPrincipal,
    action: "connect_account",
    endpoint: ENDPOINT_PATH,
    chargeId: null,
    resultStatus: "ok",
    latencyMs: Math.round(performance.now() - startMs),
    ipHash,
    userAgent,
  });

  const headers: Record<string, string> = {};
  if (result.settleResponseHeader) {
    headers["X-PAYMENT-RESPONSE"] = result.settleResponseHeader;
  }

  return NextResponse.json(result.payload, { status: 200, headers });
}

// ---------------------------------------------------------------------------
// Error response builder for connect
// ---------------------------------------------------------------------------

function buildConnectErrorResponse(error: ConnectVerifyError): NextResponse {
  switch (error.kind) {
    case "rate_limited":
      return NextResponse.json(
        { error: "rate_limited", retryAfter: error.retryAfterSeconds },
        {
          status: 429,
          headers: { "Retry-After": String(error.retryAfterSeconds) },
        }
      );

    case "missing_payment_header":
    case "malformed_payment":
    case "missing_body":
    case "malformed_body":
    case "unsupported_platform":
      return NextResponse.json(
        { error: error.kind, message: error.message },
        { status: 400 }
      );

    case "wallet_not_registered":
      return NextResponse.json(
        { error: "wallet_not_registered", message: error.message },
        { status: 401 }
      );

    case "verify_invalid_signature":
      return NextResponse.json(
        { error: "invalid_payment_signature", message: error.message },
        { status: 400 }
      );

    case "verify_amount_mismatch":
    case "verify_network_mismatch":
    case "verify_recipient_mismatch":
      return NextResponse.json(
        { error: error.kind, message: error.message },
        { status: 402 }
      );

    case "settle_insufficient_funds":
      return NextResponse.json(
        { error: "insufficient_funds", message: error.message },
        { status: 402 }
      );

    case "verify_replay_detected":
      return NextResponse.json(
        { error: "replay", message: error.message },
        { status: 409 }
      );

    case "verify_kyt_sanctioned":
      return NextResponse.json(
        { error: "sanctioned", message: error.message },
        { status: 403 }
      );

    case "verify_facilitator_error":
    case "settle_facilitator_error":
      return NextResponse.json(
        { error: "facilitator_unavailable", message: error.message },
        { status: 502 }
      );

    case "settle_timeout":
      return NextResponse.json(
        { error: "settlement_timeout", message: error.message },
        { status: 504 }
      );

    case "settle_not_verified":
    case "oauth_url_build_failed":
      return NextResponse.json(
        { error: "internal", message: error.message },
        { status: 500 }
      );

    case "db_insert_failed_refund_initiated":
      return NextResponse.json(
        {
          error: "internal",
          refundInitiated: true,
          refundTxHash: error.refundTxHash,
        },
        { status: 500 }
      );

    default: {
      const _exhaustive: never = error;
      void _exhaustive;
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }
  }
}

function mapErrorToAuditStatus(
  error: ConnectVerifyError
): "rate_limited" | "sanctioned" | "error" {
  if (error.kind === "rate_limited") return "rate_limited";
  if (error.kind === "verify_kyt_sanctioned") return "sanctioned";
  return "error";
}
