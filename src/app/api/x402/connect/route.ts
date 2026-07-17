import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { extractIpHash, extractUserAgent } from "@/lib/api/context";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";

import { getNetworkConfig, getDefaultNetwork } from "@/lib/x402/networks";
import type { NetworkConfig } from "@/lib/x402/networks";
import {
  getBaseUrl,
  getRecipientAddress,
  isX402Platform,
  X402_PLATFORMS,
} from "@/lib/x402/config";
import {
  readPaymentHeader,
  paymentResponseHeaders,
} from "@/lib/x402/http/paymentHttp";
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

/**
 * Platform used to price the 402 challenge when an unpaid request omits
 * ?platform. connect_account has a single platform-independent price, so
 * any member of X402_PLATFORMS yields the same challenge; paid requests
 * still require an explicit valid ?platform.
 */
const CHALLENGE_FALLBACK_PLATFORM = "linkedin" as const;

/**
 * POST /api/x402/connect?platform=linkedin
 *
 * x402 paid OAuth initiation (connect_account pricing action).
 *
 * Flow (payment-first):
 *   - No payment header: return 402 challenge (PAYMENT-REQUIRED header +
 *     body). ?platform is optional here so A2MCP validation probes with a
 *     bare URL still get the standard challenge.
 *   - Payment header present: require valid ?platform, verify payment,
 *     settle, create pending connection, return OAuth URL + connection
 *     token
 *
 * Query params:
 *   ?platform (required on paid requests; any X402_PLATFORMS member)
 *   ?network=polygon|arbitrum|celo|solana (optional; default base; unknown
 *   values are 400)
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const startMs = performance.now();
  const ipHash = await extractIpHash();
  const userAgent = await extractUserAgent();

  // Helper: audit entry for this endpoint with the current latency.
  const logConnectCall = async (params: {
    principal: WalletPrincipal | null;
    chargeId: string | null;
    resultStatus: "ok" | "402_required" | "sanctioned" | "rate_limited" | "error";
  }): Promise<void> => {
    await logX402Call({
      principal: params.principal,
      action: "connect_account",
      endpoint: ENDPOINT_PATH,
      chargeId: params.chargeId,
      resultStatus: params.resultStatus,
      latencyMs: Math.round(performance.now() - startMs),
      ipHash,
      userAgent,
    });
  };

  // -- Check for the payment header first (payment-first ordering): an
  // unpaid request gets the 402 challenge even without a valid ?platform.
  const paymentHeader = readPaymentHeader(request);

  // -- Parse platform query param (required only when a payment is presented)
  const url = new URL(request.url);
  const platformParam = url.searchParams.get("platform");
  const requestedPlatform =
    platformParam !== null && isX402Platform(platformParam)
      ? platformParam
      : null;

  if (requestedPlatform === null && paymentHeader) {
    await logConnectCall({ principal: null, chargeId: null, resultStatus: "error" });
    return NextResponse.json(
      {
        error: "invalid_platform",
        message: `Query param ?platform is required. Supported: ${[...X402_PLATFORMS].join(", ")}.`,
      },
      { status: 400 }
    );
  }
  const platform = requestedPlatform ?? CHALLENGE_FALLBACK_PLATFORM;

  // -- Challenge path (no payment header)
  if (!paymentHeader) {
    return respondUnpaidConnectChallenge(request, platform, (resultStatus) =>
      logConnectCall({ principal: null, chargeId: null, resultStatus })
    );
  }

  // -- Resolve network (unknown values are rejected)
  const networkParam = url.searchParams.get("network");
  let network: NetworkConfig;
  if (networkParam) {
    const requestedNetwork = getNetworkConfig(networkParam);
    if (!requestedNetwork) {
      await logConnectCall({ principal: null, chargeId: null, resultStatus: "error" });
      return NextResponse.json(
        {
          error: "unsupported_network",
          message: `Network "${networkParam}" is not supported.`,
        },
        { status: 400 }
      );
    }
    network = requestedNetwork;
  } else {
    network = getDefaultNetwork();
  }

  // -- Build network context
  const recipientAddress = getRecipientAddress(network);
  if (!recipientAddress) {
    console.error(`[POST /api/x402/connect] Recipient address env not set for network "${network.name}".`);
    await logConnectCall({ principal: null, chargeId: null, resultStatus: "error" });
    return NextResponse.json(
      { error: "internal", message: "Server misconfiguration." },
      { status: 500 }
    );
  }

  const context: ConnectNetworkContext = {
    network,
    recipientAddress,
    resourceUrl: `${getBaseUrl()}${ENDPOINT_PATH}`,
    platform,
  };

  // -- Verify path
  const result = await handleConnectVerify(paymentHeader, context);

  if (!result.ok) {
    await logConnectCall({
      principal: null,
      chargeId: null,
      resultStatus: mapErrorToAuditStatus(result.error),
    });
    return buildConnectErrorResponse(result.error);
  }

  // -- Success
  await logConnectCall({
    principal: result.principal,
    chargeId: result.chargeId,
    resultStatus: "ok",
  });

  const headers: Record<string, string> = result.settleResponseHeader
    ? paymentResponseHeaders(result.settleResponseHeader)
    : {};

  return NextResponse.json(result.payload, { status: 200, headers });
}

/**
 * GET /api/x402/connect
 *
 * Challenge-only probe path: A2MCP marketplace validators (OKX) GET
 * registered endpoints (curl -i) and require the standard 402 challenge.
 * Never initiates a connection; the paid flow lives on POST. Next.js
 * derives HEAD from this handler automatically.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const startMs = performance.now();
  const ipHash = await extractIpHash();
  const userAgent = await extractUserAgent();

  const url = new URL(request.url);
  const platformParam = url.searchParams.get("platform");
  const platform =
    platformParam !== null && isX402Platform(platformParam)
      ? platformParam
      : CHALLENGE_FALLBACK_PLATFORM;

  return respondUnpaidConnectChallenge(request, platform, async (resultStatus) => {
    await logX402Call({
      principal: null,
      action: "connect_account",
      endpoint: ENDPOINT_PATH,
      chargeId: null,
      resultStatus,
      latencyMs: Math.round(performance.now() - startMs),
      ipHash,
      userAgent,
    });
  });
}

// ---------------------------------------------------------------------------
// Shared unpaid-challenge path (POST without payment header, and GET)
// ---------------------------------------------------------------------------

/**
 * Rate limits, resolves the network from ?network, and returns the 402
 * challenge for connect_account. Shared by the POST challenge branch and
 * the GET probe handler so the two paths cannot drift.
 */
async function respondUnpaidConnectChallenge(
  request: NextRequest,
  platform: Platform,
  logCall: (
    resultStatus: "402_required" | "rate_limited" | "error"
  ) => Promise<void>,
): Promise<NextResponse> {
  const rateLimitResult = await checkRateLimit(
    "x402_connect_challenge",
    null,
    10,
    60
  );
  if (!rateLimitResult.success) {
    await logCall("rate_limited");
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

  const url = new URL(request.url);
  const networkParam = url.searchParams.get("network");
  let network: NetworkConfig;
  if (networkParam) {
    const requestedNetwork = getNetworkConfig(networkParam);
    if (!requestedNetwork) {
      await logCall("error");
      return NextResponse.json(
        {
          error: "unsupported_network",
          message: `Network "${networkParam}" is not supported.`,
        },
        { status: 400 }
      );
    }
    network = requestedNetwork;
  } else {
    network = getDefaultNetwork();
  }

  const recipientAddress = getRecipientAddress(network);
  if (!recipientAddress) {
    console.error(`[respondUnpaidConnectChallenge] Recipient address env not set for network "${network.name}".`);
    await logCall("error");
    return NextResponse.json(
      { error: "internal", message: "Server misconfiguration." },
      { status: 500 }
    );
  }

  const result = await handleConnectChallenge({
    network,
    recipientAddress,
    resourceUrl: `${getBaseUrl()}${ENDPOINT_PATH}`,
    platform,
  });
  if (!result.ok) {
    console.error(`[respondUnpaidConnectChallenge] Challenge build failed: ${result.message}`);
    await logCall("error");
    // A missing Solana fee payer is an upstream facilitator outage, not a
    // server bug: 502 facilitator_unavailable, matching the verify paths.
    if (result.error === "fee_payer_unavailable") {
      return NextResponse.json(
        { error: "facilitator_unavailable", message: result.message },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: "internal", message: result.message },
      { status: 500 }
    );
  }

  await logCall("402_required");
  return buildPaymentRequiredResponse(result.challengeBody);
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

    case "malformed_payment":
      return NextResponse.json(
        { error: error.kind, message: error.message },
        { status: 400 }
      );

    case "wallet_sanctioned":
      return NextResponse.json(
        { error: "sanctioned", message: error.message },
        { status: 403 }
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
    case "db_error":
    case "server_misconfiguration":
      return NextResponse.json(
        { error: "internal", message: error.message },
        { status: 500 }
      );

    case "db_insert_failed":
      // refundInitiated is only true when the on-chain refund actually
      // succeeded; false plus a null tx hash means the settled payment
      // needs manual reconciliation.
      return NextResponse.json(
        {
          error: "internal",
          refundInitiated: error.refundInitiated,
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
  if (error.kind === "verify_kyt_sanctioned" || error.kind === "wallet_sanctioned") {
    return "sanctioned";
  }
  return "error";
}
