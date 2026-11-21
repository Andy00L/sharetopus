import "server-only";

import type { NextRequest } from "next/server";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import type { NetworkConfig } from "@/lib/x402/networks";
import { getSolanaFeePayer } from "@/lib/x402/solana/feePayer";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";

/** Payment proof header: v2 PAYMENT-SIGNATURE, falling back to v1 X-PAYMENT. */
export function readPaymentHeader(req: NextRequest): string | null {
  return req.headers.get("payment-signature") ?? req.headers.get("x-payment");
}

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
  | { ok: false; reason: "fee_payer_unavailable" | "invalid_amount"; message: string };

export async function buildPaymentRequirements(params: {
  network: NetworkConfig;
  amountUsdc: number;
  recipientAddress: string;
}): Promise<BuildPaymentRequirementsResult> {
  const atomicAmount = usdcToAtomic(params.amountUsdc, params.network.usdcDecimals);
  if (!atomicAmount.ok) {
    console.error(`[buildPaymentRequirements] Refusing to charge: ${atomicAmount.message}`);
    return { ok: false, reason: "invalid_amount", message: "Pricing for this action is misconfigured." };
  }
  const extraResult = await buildRequirementsExtra(params.network);
  if (!extraResult.ok) return extraResult;
  return {
    ok: true,
    requirements: {
      scheme: "exact",
      network: params.network.caipNetwork,
      asset: params.network.usdcAddress,
      amount: atomicAmount.atomicAmount.toString(),
      payTo: params.recipientAddress,
      maxTimeoutSeconds: 300,
      extra: extraResult.extra,
    },
  };
}

async function buildRequirementsExtra(
  network: NetworkConfig
): Promise<
  | { ok: true; extra: Record<string, unknown> }
  | { ok: false; reason: "fee_payer_unavailable"; message: string }
> {
  if (network.family === "evm") {
    return {
      ok: true,
      extra: { name: network.usdcEip712.name, version: network.usdcEip712.version },
    };
  }

  const feePayerResult = await getSolanaFeePayer();
  if (!feePayerResult.ok) {
    console.error(
      `[buildRequirementsExtra] Solana fee payer unavailable: ${feePayerResult.message}`
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
  | Extract<BuildPaymentRequirementsResult, { ok: false }>;

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
