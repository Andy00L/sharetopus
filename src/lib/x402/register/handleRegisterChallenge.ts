import "server-only";

import type { PaymentRequired } from "@x402/core/types";
import type { RegisterNetworkContext } from "./types";
import { createSiweNonce } from "@/lib/x402/siwe/createSiweNonce";
import { readActionPrice } from "@/lib/x402/pricing/readActionPrice";
import { buildPaymentRequired } from "@/lib/x402/http/paymentHttp";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RegisterChallengeResult =
  | { ok: true; challengeBody: PaymentRequired }
  | {
      ok: false;
      error:
        | "nonce_creation_failed"
        | "pricing_lookup_failed"
        | "fee_payer_unavailable";
      message: string;
    };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Builds the 402 Payment Required body for /register.
 *
 * Reads the currently effective price for the 'register' action and bundles
 * a fresh SIWE nonce (siwe_nonces row, 5-min expiry) inside the v2
 * `extensions` field so the agent can construct its SIWE message in a
 * single round-trip.
 *
 * Called by: POST /api/x402/register (challenge path)
 * Tables touched: pricing_actions (read), siwe_nonces (insert)
 */
export async function handleRegisterChallenge(
  context: RegisterNetworkContext
): Promise<RegisterChallengeResult> {
  const priceResult = await readActionPrice("register");
  if (!priceResult.ok) {
    console.error(`[handleRegisterChallenge] Failed to read register pricing: ${priceResult.message}`);
    return {
      ok: false,
      error: "pricing_lookup_failed",
      message: priceResult.message,
    };
  }

  // Generate a fresh SIWE nonce with 5-minute expiry.
  const nonceResult = await createSiweNonce();
  if (!nonceResult.ok) {
    return {
      ok: false,
      error: "nonce_creation_failed",
      message: nonceResult.message,
    };
  }

  // On Solana this resolves the facilitator fee payer; failure means no
  // payable 402 can be built (the already-created nonce row simply expires).
  const challengeResult = await buildPaymentRequired({
    resourceUrl: context.resourceUrl,
    network: context.network,
    amountUsdc: priceResult.usdcPrice,
    recipientAddress: context.recipientAddress,
    extensions: {
      siweNonce: nonceResult.nonce,
      siweExpiresAt: nonceResult.expiresAt,
    },
  });
  if (!challengeResult.ok) {
    return {
      ok: false,
      error: challengeResult.reason,
      message: challengeResult.message,
    };
  }

  return { ok: true, challengeBody: challengeResult.paymentRequired };
}
