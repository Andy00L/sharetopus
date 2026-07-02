import "server-only";

import type { PaymentRequired } from "@x402/core/types";
import type { ConnectNetworkContext } from "./types";
import { readActionPrice } from "@/lib/x402/pricing/readActionPrice";
import { buildPaymentRequired } from "@/lib/x402/http/paymentHttp";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectChallengeResult =
  | { ok: true; challengeBody: PaymentRequired }
  | {
      ok: false;
      error: "pricing_lookup_failed" | "fee_payer_unavailable";
      message: string;
    };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Builds the 402 Payment Required body for /connect.
 *
 * Reads the currently effective price for the 'connect_account' action. The
 * 402 carries no extensions: the wallet is identified by the payment
 * signature alone, and a first-time paying wallet is onboarded during
 * verify.
 *
 * Called by: POST /api/x402/connect (challenge path)
 * Tables touched: pricing_actions (read)
 */
export async function handleConnectChallenge(
  context: ConnectNetworkContext
): Promise<ConnectChallengeResult> {
  const priceResult = await readActionPrice("connect_account");
  if (!priceResult.ok) {
    console.error(`[handleConnectChallenge] Failed to read connect pricing: ${priceResult.message}`);
    return {
      ok: false,
      error: "pricing_lookup_failed",
      message: priceResult.message,
    };
  }

  // On Solana this resolves the facilitator fee payer; failure means no
  // payable 402 can be built.
  const challengeResult = await buildPaymentRequired({
    resourceUrl: context.resourceUrl,
    network: context.network,
    amountUsdc: priceResult.usdcPrice,
    recipientAddress: context.recipientAddress,
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
