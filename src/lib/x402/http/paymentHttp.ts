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

/**
 * One exact-scheme USDC requirement for the given network and price.
 *
 * extra carries the USDC EIP-712 domain (name/version) on EVM networks:
 * exact-scheme clients need it to sign the EIP-3009 authorization and the
 * official @x402/evm client refuses to sign without it. assetTransferMethod
 * is omitted because eip3009 is the scheme default. Solana has no EIP-712
 * domain; its extra stays empty.
 */
export function buildPaymentRequirements(params: {
  network: NetworkConfig;
  amountUsdc: number;
  recipientAddress: string;
}): PaymentRequirements {
  const eip712Domain = params.network.usdcEip712;
  return {
    scheme: "exact",
    network: params.network.caipNetwork as `${string}:${string}`,
    asset: params.network.usdcAddress,
    amount: usdcToAtomic(params.amountUsdc, params.network.usdcDecimals),
    payTo: params.recipientAddress,
    maxTimeoutSeconds: 300,
    extra: eip712Domain
      ? { name: eip712Domain.name, version: eip712Domain.version }
      : {},
  };
}

/** Full v2 PaymentRequired object for a 402 response (header and body). */
export function buildPaymentRequired(params: {
  resourceUrl: string;
  network: NetworkConfig;
  amountUsdc: number;
  recipientAddress: string;
  error?: string;
  extensions?: Record<string, unknown>;
}): PaymentRequired {
  const paymentRequired: PaymentRequired = {
    x402Version: 2,
    resource: { url: params.resourceUrl },
    accepts: [
      buildPaymentRequirements({
        network: params.network,
        amountUsdc: params.amountUsdc,
        recipientAddress: params.recipientAddress,
      }),
    ],
  };
  if (params.error) paymentRequired.error = params.error;
  if (params.extensions) paymentRequired.extensions = params.extensions;
  return paymentRequired;
}
