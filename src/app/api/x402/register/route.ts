import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { extractIpHash, extractUserAgent } from "@/lib/api/context";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";

import { getNetworkConfig, getDefaultNetwork } from "@/lib/x402/networks";
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
 *   - If no X-PAYMENT header: return 402 challenge + SIWE nonce
 *   - If X-PAYMENT present: verify SIWE + payment, settle, atomic DB insert
 *
 * Query params:
 *   ?network=polygon    override default network (mainnet only)
 *
 * Auth: none at request level. Wallet identity established via SIWE +
 * payment signature.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const startMs = performance.now();
  const ipHash = await extractIpHash();
  const userAgent = await extractUserAgent();

  // ── Resolve network from query param ───────────────────────────────
  // Default: mainnet base. Override with ?network=polygon|arbitrum|solana.
  const url = new URL(request.url);
  const networkParam = url.searchParams.get("network");
  const network = networkParam
    ? getNetworkConfig(networkParam) ?? getDefaultNetwork()
    : getDefaultNetwork();

  // ── Build network context ──────────────────────────────────────────
  const recipientAddress = network.isEvm
    ? process.env.X402_RECIPIENT_EVM
    : process.env.X402_RECIPIENT_SOLANA;
  if (!recipientAddress) {
    console.error("[POST /api/x402/register] X402_RECIPIENT_EVM env not set");
    await logX402Call({
      principal: null,
      action: "register",
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

  const context: RegisterNetworkContext = {
    network,
    recipientAddress,
    expectedDomain,
    resourceUrl,
  };

  // ── Check for X-PAYMENT header ─────────────────────────────────────
  const paymentHeader = request.headers.get("x-payment");

  if (!paymentHeader) {
    // ── Challenge path ─────────────────────────────────────────────
    const rateLimitResult = await checkRateLimit(
      "x402_register_challenge",
      null,
      10,
      60
    );
    if (!rateLimitResult.success) {
      await logX402Call({
        principal: null,
        action: "register",
        endpoint: ENDPOINT_PATH,
        chargeId: null,
        resultStatus: "rate_limited",
        latencyMs: Math.round(performance.now() - startMs),
        ipHash,
        userAgent,
      });
      return buildRegisterErrorResponse({
        kind: "rate_limited",
        retryAfterSeconds: rateLimitResult.resetIn ?? 60,
      });
    }

    const result = await handleRegisterChallenge(context);
    if (!result.ok) {
      console.error(`[POST /api/x402/register] Challenge build failed: ${result.message}`);
      await logX402Call({
        principal: null,
        action: "register",
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
      action: "register",
      endpoint: ENDPOINT_PATH,
      chargeId: null,
      resultStatus: "402_required",
      latencyMs: Math.round(performance.now() - startMs),
      ipHash,
      userAgent,
    });

    return buildPaymentRequiredResponse(result.challengeBody);
  }

  // ── Verify path ────────────────────────────────────────────────────
  const result = network.isEvm
    ? await handleRegisterVerify(request, paymentHeader, context, ipHash)
    : await handleRegisterSolanaVerify(request, paymentHeader, context, ipHash);

  if (!result.ok) {
    const auditStatus =
      result.error.kind === "rate_limited"
        ? ("rate_limited" as const)
        : result.error.kind === "verify_kyt_sanctioned"
          ? ("sanctioned" as const)
          : ("error" as const);

    await logX402Call({
      principal: null,
      action: "register",
      endpoint: ENDPOINT_PATH,
      chargeId: null,
      resultStatus: auditStatus,
      latencyMs: Math.round(performance.now() - startMs),
      ipHash,
      userAgent,
    });

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

  await logX402Call({
    principal: walletPrincipal,
    action: "register",
    endpoint: ENDPOINT_PATH,
    chargeId: result.payload.chargeId,
    resultStatus: "ok",
    latencyMs: Math.round(performance.now() - startMs),
    ipHash,
    userAgent,
  });

  return buildRegisterSuccessResponse(
    result.payload,
    result.settleResponseHeader
  );
}
