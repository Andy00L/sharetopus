import "server-only";

import type { PaymentRequired } from "@x402/core/types";
import type { ConnectNetworkContext, Platform } from "./types";
import { isX402Platform } from "@/lib/x402/config";
import { readActionPrice } from "@/lib/x402/pricing/readActionPrice";
import { buildPaymentRequired } from "@/lib/x402/http/paymentHttp";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectChallengeResult =
  | { ok: true; challengeBody: PaymentRequired }
  | {
      ok: false;
      error:
        | "pricing_lookup_failed"
        | "unsupported_platform"
        | "fee_payer_unavailable";
      message: string;
    };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Builds the 402 Payment Required body for /connect.
 *
 * Reads the currently effective price for the 'connect_account' action. No
 * SIWE nonce in the response: the wallet is already registered and is
 * identified by the payment signature alone.
 *
 * Called by: POST /api/x402/connect (challenge path)
 * Tables touched: pricing_actions (read)
 */
export async function handleConnectChallenge(
  context: ConnectNetworkContext,
  platform: Platform
): Promise<ConnectChallengeResult> {
  if (!isX402Platform(platform)) {
    return {
      ok: false,
      error: "unsupported_platform",
      message: `Platform "${platform}" is not supported for x402 connect.`,
    };
  }

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
