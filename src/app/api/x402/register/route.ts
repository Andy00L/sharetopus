import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { extractIpHash, extractUserAgent } from "@/lib/api/context";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";

import { getNetworkConfig, getDefaultNetwork } from "@/lib/x402/networks";
import type { NetworkConfig } from "@/lib/x402/networks";
import {
  getBaseUrl,
  getExpectedDomain,
  getRecipientAddress,
} from "@/lib/x402/config";
import { readPaymentHeader } from "@/lib/x402/http/paymentHttp";
import { logX402Call } from "@/lib/x402/audit/logX402Call";
import { handleRegisterChallenge } from "@/lib/x402/register/handleRegisterChallenge";
import { handleRegisterVerify } from "@/lib/x402/register/handleRegisterVerify";
import { handleRegisterSolanaVerify } from "@/lib/x402/register/handleRegisterSolanaVerify";
import { buildPaymentRequiredResponse } from "@/lib/x402/responses/buildPaymentRequiredResponse";
import { buildRegisterSuccessResponse } from "@/lib/x402/responses/buildSuccessResponse";
import { buildRegisterErrorResponse } from "@/lib/x402/responses/buildErrorResponse";
import type { RegisterNetworkContext } from "@/lib/x402/register/types";
import type { WalletPrincipal } from "@/lib/x402/auth/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ENDPOINT_PATH = "/api/x402/register";

/**
 * POST /api/x402/register
 *
 * x402 wallet registration endpoint. First call from any agent.
 *
 * Flow:
 *   - No payment header: return 402 challenge (PAYMENT-REQUIRED header +
 *     body) with a bundled SIWE nonce
 *   - Payment header present: verify SIWE/SIWS + payment, settle, atomic
 *     DB insert
 *
 * Query params:
 *   ?network=polygon    override default network (unknown values are 400)
 *
 * Auth: none at request level. Wallet identity established via SIWE +
 * payment signature.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const startMs = performance.now();
  const ipHash = await extractIpHash();
  const userAgent = await extractUserAgent();

  // Helper: audit entry for this endpoint with the current latency.
  const logRegisterCall = async (params: {
    principal: WalletPrincipal | null;
    chargeId: string | null;
    resultStatus: "ok" | "402_required" | "sanctioned" | "rate_limited" | "error";
  }): Promise<void> => {
    await logX402Call({
      principal: params.principal,
      action: "register",
      endpoint: ENDPOINT_PATH,
      chargeId: params.chargeId,
      resultStatus: params.resultStatus,
      latencyMs: Math.round(performance.now() - startMs),
      ipHash,
      userAgent,
    });
  };

  // ── Resolve network from query param ───────────────────────────────
  const url = new URL(request.url);
  const networkParam = url.searchParams.get("network");
  let network: NetworkConfig;
  if (networkParam) {
    const requestedNetwork = getNetworkConfig(networkParam);
    if (!requestedNetwork) {
      await logRegisterCall({ principal: null, chargeId: null, resultStatus: "error" });
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

  // ── Build network context ──────────────────────────────────────────
  const recipientAddress = getRecipientAddress(network);
  if (!recipientAddress) {
    console.error(`[POST /api/x402/register] Recipient address env not set for network "${network.name}".`);
    await logRegisterCall({ principal: null, chargeId: null, resultStatus: "error" });
    return NextResponse.json(
      { error: "internal", message: "Server misconfiguration." },
      { status: 500 }
    );
  }

  const context: RegisterNetworkContext = {
    network,
    recipientAddress,
    expectedDomain: getExpectedDomain(),
    resourceUrl: `${getBaseUrl()}${ENDPOINT_PATH}`,
  };

  // ── Check for the payment header ───────────────────────────────────
  const paymentHeader = readPaymentHeader(request);

  if (!paymentHeader) {
    // ── Challenge path ─────────────────────────────────────────────
    const rateLimitResult = await checkRateLimit(
      "x402_register_challenge",
      null,
      10,
      60
    );
    if (!rateLimitResult.success) {
      await logRegisterCall({ principal: null, chargeId: null, resultStatus: "rate_limited" });
      return buildRegisterErrorResponse({
        kind: "rate_limited",
        retryAfterSeconds: rateLimitResult.resetIn ?? 60,
      });
    }

    const result = await handleRegisterChallenge(context);
    if (!result.ok) {
      console.error(`[POST /api/x402/register] Challenge build failed: ${result.message}`);
      await logRegisterCall({ principal: null, chargeId: null, resultStatus: "error" });
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

    await logRegisterCall({ principal: null, chargeId: null, resultStatus: "402_required" });
    return buildPaymentRequiredResponse(result.challengeBody);
  }

  // ── Verify path ────────────────────────────────────────────────────
  const result = network.isEvm
    ? await handleRegisterVerify(request, paymentHeader, context)
    : await handleRegisterSolanaVerify(request, paymentHeader, context);

  if (!result.ok) {
    const auditStatus =
      result.error.kind === "rate_limited"
        ? ("rate_limited" as const)
        : result.error.kind === "verify_kyt_sanctioned"
          ? ("sanctioned" as const)
          : ("error" as const);

    await logRegisterCall({ principal: null, chargeId: null, resultStatus: auditStatus });
    return buildRegisterErrorResponse(result.error);
  }

  // ── Success ────────────────────────────────────────────────────────
  const walletPrincipal: WalletPrincipal = {
    kind: "wallet",
    principalId: result.payload.principalId,
    walletId: result.payload.walletId,
    address: result.payload.address,
    chain: result.payload.chain,
    sanctionsStatus: result.payload.sanctionsStatus,
  };

  await logRegisterCall({
    principal: walletPrincipal,
    chargeId: result.payload.chargeId,
    resultStatus: "ok",
  });

  return buildRegisterSuccessResponse(
    result.payload,
    result.settleResponseHeader
  );
}
