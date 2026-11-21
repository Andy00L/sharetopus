import "server-only";

import type { PaymentRequired } from "@x402/core/types";
import type { ConnectNetworkContext } from "./types";
import { readActionPrice } from "@/lib/x402/pricing/readActionPrice";
import { buildPaymentRequired, type BuildPaymentRequiredResult } from "@/lib/x402/http/paymentHttp";

export type ConnectChallengeResult =
  | { ok: true; challengeBody: PaymentRequired }
  | {
      ok: false;
      error: "pricing_lookup_failed" | Extract<BuildPaymentRequiredResult, { ok: false }>["reason"];
      message: string;
    };

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
