import "server-only";

/**
 * x402 v2 HTTP transport helpers.
 *
 * v2 moved the protocol data into headers: the client submits payment proof
 * in PAYMENT-SIGNATURE (v1: X-PAYMENT), the server answers 402s with a
 * base64 PAYMENT-REQUIRED header (the JSON body is non-normative), and
 * settlement details return in PAYMENT-RESPONSE (v1: X-PAYMENT-RESPONSE).
 * Per the migration guide, v2 libraries accept both header generations, so
 * these helpers read the v2 name first and fall back to v1, and emit both
 * header generations on responses.
 *
 * Called by: x402PaidEndpoint, register/connect routes, responses/ builders
 * Tables touched: none
 */

import type { NextRequest } from "next/server";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import type { NetworkConfig } from "@/lib/x402/networks";
import { getSolanaFeePayer } from "@/lib/x402/solana/feePayer";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";

/** Payment proof header: v2 PAYMENT-SIGNATURE, falling back to v1 X-PAYMENT. */
export function readPaymentHeader(req: NextRequest): string | null {
  return req.headers.get("payment-signature") ?? req.headers.get("x-payment");
}

/** Settlement response headers for both header generations. */
export function paymentResponseHeaders(
  encodedSettleResponse: string
): Record<string, string> {
  return {
    "PAYMENT-RESPONSE": encodedSettleResponse,
    "X-PAYMENT-RESPONSE": encodedSettleResponse,
  };
}

export type BuildPaymentRequirementsResult =
  | { ok: true; requirements: PaymentRequirements }
  | { ok: false; reason: "fee_payer_unavailable"; message: string };

/**
 * One exact-scheme USDC requirement for the given network and price.
 *
 * extra carries the USDC EIP-712 domain (name/version) on EVM networks:
 * exact-scheme clients need it to sign the EIP-3009 authorization and the
 * official @x402/evm client refuses to sign without it. assetTransferMethod
 * is omitted because eip3009 is the scheme default. On Solana, extra carries
 * the facilitator's feePayer (from the facilitator /supported endpoint,
 * cached in solana/feePayer.ts): the official @x402/svm client refuses to
 * build a transaction without it, and the facilitator rejects requirements
 * whose feePayer is not one of its signers. When the fee payer cannot be
 * resolved, the failure variant is returned instead of an unpayable 402 with
 * an empty extra; the EVM branch never awaits and is unaffected by a
 * fee-payer outage.
 */
export async function buildPaymentRequirements(params: {
  network: NetworkConfig;
  amountUsdc: number;
  recipientAddress: string;
}): Promise<BuildPaymentRequirementsResult> {
  const extraResult = await buildRequirementsExtra(params.network);
  if (!extraResult.ok) return extraResult;
  return {
    ok: true,
    requirements: {
      scheme: "exact",
      network: params.network.caipNetwork as `${string}:${string}`,
      asset: params.network.usdcAddress,
      amount: usdcToAtomic(params.amountUsdc, params.network.usdcDecimals),
      payTo: params.recipientAddress,
      maxTimeoutSeconds: 300,
      extra: extraResult.extra,
    },
  };
}

/** Scheme extra per network family. The EVM arm is frozen (see above). */
async function buildRequirementsExtra(
  network: NetworkConfig
): Promise<
  | { ok: true; extra: Record<string, unknown> }
  | { ok: false; reason: "fee_payer_unavailable"; message: string }
> {
  if (network.isEvm) {
    const eip712Domain = network.usdcEip712;
    return {
      ok: true,
      extra: eip712Domain
        ? { name: eip712Domain.name, version: eip712Domain.version }
        : {},
    };
  }

  const feePayerResult = await getSolanaFeePayer();
  if (!feePayerResult.ok) {
    console.error(
      `[buildPaymentRequirements] Solana fee payer unavailable: ${feePayerResult.message}`
    );
    return {
      ok: false,
      reason: "fee_payer_unavailable",
      message: "Facilitator fee payer for Solana is currently unavailable.",
    };
  }
  return { ok: true, extra: { feePayer: feePayerResult.feePayer } };
}

export type BuildPaymentRequiredResult =
  | { ok: true; paymentRequired: PaymentRequired }
  | { ok: false; reason: "fee_payer_unavailable"; message: string };

/** Full v2 PaymentRequired object for a 402 response (header and body). */
export async function buildPaymentRequired(params: {
  resourceUrl: string;
  network: NetworkConfig;
  amountUsdc: number;
  recipientAddress: string;
  error?: string;
  extensions?: Record<string, unknown>;
}): Promise<BuildPaymentRequiredResult> {
  const requirementsResult = await buildPaymentRequirements({
    network: params.network,
    amountUsdc: params.amountUsdc,
    recipientAddress: params.recipientAddress,
  });
  if (!requirementsResult.ok) return requirementsResult;

  const paymentRequired: PaymentRequired = {
    x402Version: 2,
    resource: { url: params.resourceUrl },
    accepts: [requirementsResult.requirements],
  };
  if (params.error) paymentRequired.error = params.error;
  if (params.extensions) paymentRequired.extensions = params.extensions;
  return { ok: true, paymentRequired };
}
