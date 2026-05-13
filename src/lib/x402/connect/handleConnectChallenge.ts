import "server-only";

import type { ConnectNetworkContext, Platform } from "./types";
import type { PaymentRequiredChallengeBody } from "@/lib/x402/register/handleRegisterChallenge";
import { adminSupabase } from "@/actions/api/adminSupabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectChallengeResult =
  | { ok: true; challengeBody: PaymentRequiredChallengeBody }
  | {
      ok: false;
      error: "pricing_lookup_failed" | "unsupported_platform";
      message: string;
    };

const VALID_PLATFORMS: ReadonlySet<Platform> = new Set([
  "linkedin",
  "tiktok",
  "pinterest",
  "instagram",
]);

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Builds the 402 Payment Required response for /connect.
 *
 * Reads pricing_actions.usdc_price WHERE action='connect_account'.
 * No SIWE nonce in the response (wallet is already registered and
 * identified via X-PAYMENT signature).
 */
export async function handleConnectChallenge(
  context: ConnectNetworkContext,
  platform: Platform
): Promise<ConnectChallengeResult> {
  if (!VALID_PLATFORMS.has(platform)) {
    return {
      ok: false,
      error: "unsupported_platform",
      message: `Platform "${platform}" is not supported for x402 connect.`,
    };
  }

  // Live-read the connect price from the DB.
  const { data: pricingRow, error: pricingError } = await adminSupabase
    .from("pricing_actions")
    .select("usdc_price")
    .eq("action", "connect_account")
    .maybeSingle();

  if (pricingError || !pricingRow) {
    console.error(`[handleConnectChallenge] Failed to read connect pricing: ${pricingError?.message ?? "no row found"}`);
    return {
      ok: false,
      error: "pricing_lookup_failed",
      message:
        pricingError?.message ??
        "connect_account pricing action not found in DB.",
    };
  }

  const usdcPrice = pricingRow.usdc_price;
  const atomicAmount = String(
    Math.round(usdcPrice * 10 ** context.network.usdcDecimals)
  );

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
    // No SIWE nonce for connect: wallet is already registered.
    // Use empty strings to satisfy the type; the agent ignores these.
    siweNonce: "",
    siweExpiresAt: "",
  };

  return { ok: true, challengeBody };
}
