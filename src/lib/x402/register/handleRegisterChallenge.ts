import "server-only";

import type { RegisterNetworkContext } from "./types";
import { createSiweNonce } from "@/lib/x402/siwe/createSiweNonce";
import { adminSupabase } from "@/actions/api/adminSupabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RegisterChallengeResult =
  | { ok: true; challengeBody: PaymentRequiredChallengeBody }
  | {
      ok: false;
      error: "nonce_creation_failed" | "pricing_lookup_failed";
      message: string;
    };

/**
 * x402 protocol 402 response body with bundled SIWE nonce.
 *
 * siweNonce and siweExpiresAt live inside `extensions` per x402 v2 spec.
 * They allow the agent to construct a SIWE message in a single round-trip.
 */
export interface PaymentRequiredChallengeBody {
  x402Version: 2;
  resource: { url: string };
  accepts: Array<{
    scheme: "exact";
    network: string;
    asset: string;
    amount: string;
    payTo: string;
    maxTimeoutSeconds: 300;
    extra: Record<string, unknown>;
  }>;
  extensions: {
    siweNonce: string;
    siweExpiresAt: string;
  };
  error?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Builds the 402 Payment Required response.
 *
 * Reads pricing_actions for the 'register' action to get the current USDC
 * price (verified at $1.00 by verify-pricing-actions.ts but live-read
 * for drift safety).
 *
 * Creates a fresh SIWE nonce stored in siwe_nonces with 5-min expiry.
 */
export async function handleRegisterChallenge(
  context: RegisterNetworkContext
): Promise<RegisterChallengeResult> {
  // Live-read the register price from the DB.
  const { data: pricingRow, error: pricingError } = await adminSupabase
    .from("pricing_actions")
    .select("usdc_price")
    .eq("action", "register")
    .maybeSingle();

  if (pricingError || !pricingRow) {
    console.error(`[handleRegisterChallenge] Failed to read register pricing: ${pricingError?.message ?? "no row found"}`);
    return {
      ok: false,
      error: "pricing_lookup_failed",
      message:
        pricingError?.message ?? "Register pricing action not found in DB.",
    };
  }

  const usdcPrice = pricingRow.usdc_price;
  const atomicAmount = String(
    Math.round(usdcPrice * 10 ** context.network.usdcDecimals)
  );

  // Generate a fresh SIWE nonce with 5-minute expiry.
  const nonceResult = await createSiweNonce();
  if (!nonceResult.ok) {
    return {
      ok: false,
      error: "nonce_creation_failed",
      message: nonceResult.message,
    };
  }

  const challengeBody: PaymentRequiredChallengeBody = {
    x402Version: 2,
    resource: { url: context.resourceUrl },
    accepts: [
      {
        scheme: "exact",
        network: context.network.caipNetwork,
        asset: context.network.usdcAddress,
        amount: atomicAmount,
        payTo: context.recipientAddress,
        maxTimeoutSeconds: 300,
        extra: {},
      },
    ],
    extensions: {
      siweNonce: nonceResult.nonce,
      siweExpiresAt: nonceResult.expiresAt,
    },
  };

  return { ok: true, challengeBody };
}
