import "server-only";

import { after, NextResponse, type NextRequest } from "next/server";

import { extractIpHash, extractUserAgent } from "@/lib/api/context";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";

import { getBaseUrl, isX402Platform, X402_PLATFORMS } from "@/lib/x402/config";
import {
  readPaymentHeader,
  paymentResponseHeaders,
} from "@/lib/x402/http/paymentHttp";
import { describeRateLimitRejection } from "@/lib/x402/http/rateLimitRejection";
import { resolveRequestNetwork } from "@/lib/x402/http/resolveRequestNetwork";
import { logX402Call, type X402AuditEntry } from "@/lib/x402/audit/logX402Call";
import { handleConnectChallenge } from "@/lib/x402/connect/handleConnectChallenge";
import { handleConnectVerify } from "@/lib/x402/connect/handleConnectVerify";
import type { ConnectVerifyError } from "@/lib/x402/connect/handleConnectVerify";
import { buildPaymentRequiredResponse } from "@/lib/x402/responses/buildPaymentRequiredResponse";
import type { Platform } from "@/lib/x402/connect/types";
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

type ConnectAuditStatus = X402AuditEntry["resultStatus"];

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
 *     settle through the shared charge lifecycle, create the pending
 *     connection, return OAuth URL + connection token.
 *
 * Query params:
 *   ?platform (required on paid requests; any X402_PLATFORMS member)
 *   ?network=polygon|arbitrum|celo|arc|solana (optional; default base;
 *   unknown values are 400)
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const audit = await createConnectAudit();

  // Step 1: read the payment header before validating ?platform (x402 is
  // payment-first).
  const paymentHeader = readPaymentHeader(request);

  const url = new URL(request.url);
  const platformParam = url.searchParams.get("platform");
  const requestedPlatform =
    platformParam !== null && isX402Platform(platformParam) ? platformParam : null;

  if (requestedPlatform === null && paymentHeader) {
    audit({ principal: null, chargeId: null, resultStatus: "error" });
    return NextResponse.json(
      {
        error: "invalid_platform",
        message: `Query param ?platform is required. Supported: ${[...X402_PLATFORMS].join(", ")}.`,
      },
      { status: 400 },
    );
  }
  const platform = requestedPlatform ?? CHALLENGE_FALLBACK_PLATFORM;

  // Step 2: no payment header, answer with the challenge.
  if (!paymentHeader) {
    return respondUnpaidConnectChallenge(request, platform, audit);
  }

  // Step 3: network and payout address.
  const networkResult = resolveRequestNetwork(request.url);
  if (!networkResult.ok) {
    audit({ principal: null, chargeId: null, resultStatus: "error" });
    return networkResult.reason === "unsupported_network"
      ? NextResponse.json(
          { error: "unsupported_network", message: networkResult.message },
          { status: 400 },
        )
      : NextResponse.json({ error: "internal", message: "Server misconfiguration." }, { status: 500 });
  }

  // Step 4: verify, settle, create the connection.
  const result = await handleConnectVerify(paymentHeader, {
    network: networkResult.network,
    recipientAddress: networkResult.recipientAddress,
    resourceUrl: `${getBaseUrl()}${ENDPOINT_PATH}`,
    platform,
  });

  if (!result.ok) {
    audit({
      principal: result.principal,
      chargeId: result.chargeId,
      resultStatus: mapErrorToAuditStatus(result.error),
    });
    return buildConnectErrorResponse(result.error);
  }

  audit({ principal: result.principal, chargeId: result.chargeId, resultStatus: "ok" });

  const headers: Record<string, string> = result.settleResponseHeader
    ? paymentResponseHeaders(result.settleResponseHeader)
    : {};

  return NextResponse.json(result.payload, { status: 200, headers });
}

/**
 * GET /api/x402/connect?platform=linkedin
 *
 * Challenge-only probe for A2MCP validators (curl -i / curl -I). Always
 * answers 402; paying still requires POST.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const audit = await createConnectAudit();
  const platformParam = new URL(request.url).searchParams.get("platform");
  const platform =
    platformParam !== null && isX402Platform(platformParam)
      ? platformParam
      : CHALLENGE_FALLBACK_PLATFORM;
  return respondUnpaidConnectChallenge(request, platform, audit);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ConnectAudit = (entry: {
  principal: WalletPrincipal | null;
  chargeId: string | null;
  resultStatus: ConnectAuditStatus;
}) => void;

/** Audit rows for /connect are written after the response is sent. */
async function createConnectAudit(): Promise<ConnectAudit> {
  const startMs = performance.now();
  const ipHash = await extractIpHash();
  const userAgent = await extractUserAgent();
  return (entry) => {
    const auditEntry: X402AuditEntry = {
      principal: entry.principal,
      action: "connect_account",
      endpoint: ENDPOINT_PATH,
      chargeId: entry.chargeId,
      resultStatus: entry.resultStatus,
      latencyMs: Math.round(performance.now() - startMs),
      ipHash,
      userAgent,
    };
    after(() => logX402Call(auditEntry));
  };
}

/** Shared 402 challenge for POST without payment and for GET probes. */
async function respondUnpaidConnectChallenge(
  request: NextRequest,
  platform: Platform,
  audit: ConnectAudit,
): Promise<NextResponse> {
  const rateLimitResult = await checkRateLimit("x402_connect_challenge", null, 10, 60);
  if (!rateLimitResult.success) {
    const rejection = describeRateLimitRejection(rateLimitResult);
    audit({ principal: null, chargeId: null, resultStatus: rejection.auditStatus });
    return NextResponse.json(
      { error: rejection.errorKind, retryAfter: rejection.retryAfterSeconds },
      {
        status: rejection.httpStatus,
        headers: { "Retry-After": String(rejection.retryAfterSeconds) },
      },
    );
  }

  const networkResult = resolveRequestNetwork(request.url);
  if (!networkResult.ok) {
    audit({ principal: null, chargeId: null, resultStatus: "error" });
    return networkResult.reason === "unsupported_network"
      ? NextResponse.json(
          { error: "unsupported_network", message: networkResult.message },
          { status: 400 },
        )
      : NextResponse.json({ error: "internal", message: "Server misconfiguration." }, { status: 500 });
  }

  const result = await handleConnectChallenge({
    network: networkResult.network,
    recipientAddress: networkResult.recipientAddress,
    resourceUrl: `${getBaseUrl()}${ENDPOINT_PATH}`,
    platform,
  });
  if (!result.ok) {
    console.error(`[respondUnpaidConnectChallenge] Challenge build failed: ${result.message}`);
    audit({ principal: null, chargeId: null, resultStatus: "error" });
    // A missing Solana fee payer is an upstream facilitator outage, not a
    // server bug: 502 facilitator_unavailable, matching the verify paths.
    if (result.error === "fee_payer_unavailable") {
      return NextResponse.json(
        { error: "facilitator_unavailable", message: result.message },
        { status: 502 },
      );
    }
    return NextResponse.json({ error: "internal", message: result.message }, { status: 500 });
  }

  audit({ principal: null, chargeId: null, resultStatus: "402_required" });
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
        },
      );

    case "rate_limiter_unavailable":
      return NextResponse.json(
        { error: error.kind, message: error.message, retryAfter: error.retryAfterSeconds },
        {
          status: 503,
          headers: { "Retry-After": String(error.retryAfterSeconds) },
        },
      );

    case "malformed_payment":
    case "verify_invalid_payment":
      return NextResponse.json({ error: error.kind, message: error.message }, { status: 400 });

    case "wallet_sanctioned":
    case "verify_kyt_sanctioned":
      return NextResponse.json({ error: "sanctioned", message: error.message }, { status: 403 });

    case "verify_invalid_signature":
      return NextResponse.json(
        { error: "invalid_payment_signature", message: error.message },
        { status: 400 },
      );

    case "verify_amount_mismatch":
    case "verify_network_mismatch":
    case "verify_recipient_mismatch":
    case "verify_authorization_expired":
      return NextResponse.json({ error: error.kind, message: error.message }, { status: 402 });

    case "verify_insufficient_funds":
    case "settle_insufficient_funds":
    case "settle_not_verified":
      return NextResponse.json(
        {
          error: error.kind === "settle_not_verified" ? "payment_not_verified" : "insufficient_funds",
          message: error.message,
        },
        { status: 402 },
      );

    case "verify_replay_detected":
      return NextResponse.json({ error: "replay", message: error.message }, { status: 409 });

    case "payment_in_progress":
      return NextResponse.json(
        { error: "payment_in_progress", message: error.message },
        { status: 409, headers: { "Retry-After": "5" } },
      );

    case "verify_facilitator_error":
    case "settle_facilitator_error":
      return NextResponse.json(
        { error: "facilitator_unavailable", message: error.message },
        { status: 502 },
      );

    case "settle_timeout":
      return NextResponse.json({ error: "settlement_timeout", message: error.message }, { status: 504 });

    case "db_error":
    case "server_misconfiguration":
      return NextResponse.json({ error: "internal", message: error.message }, { status: 500 });

    // Its own code: the payment settled, so the client must not present it
    // again, unlike the failures above where nothing was charged.
    case "settlement_unrecorded":
      return NextResponse.json({ error: error.kind, message: error.message }, { status: 500 });

    case "db_insert_failed":
      // refundInitiated is true once a refund transaction exists; false plus
      // a null tx hash means the settled payment needs manual reconciliation.
      return NextResponse.json(
        {
          error: "internal",
          message: error.message,
          refundInitiated: error.refundInitiated,
          refundTxHash: error.refundTxHash,
        },
        { status: 500 },
      );

    default: {
      const unhandledError: never = error;
      void unhandledError;
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }
  }
}

function mapErrorToAuditStatus(error: ConnectVerifyError): ConnectAuditStatus {
  if (error.kind === "rate_limited") return "rate_limited";
  if (error.kind === "verify_kyt_sanctioned" || error.kind === "wallet_sanctioned") {
    return "sanctioned";
  }
  return "error";
}
