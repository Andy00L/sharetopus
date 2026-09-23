import "server-only";

/**
 * One facilitator client per settlement lane (networks.ts). Extracted from
 * facilitator.ts in June 2026 so solana/feePayer.ts can reuse the same
 * client without an import cycle; keyed by lane since Celo joined in July
 * 2026, because auth wiring follows the lane, not the URL.
 *
 * Called by: facilitator.ts (verify/settle), solana/feePayer.ts
 *            (getSupported), arc/facilitatorApi.ts
 * Tables touched: none
 * Env: CDP_API_KEY_ID, CDP_API_KEY_SECRET (CDP JWT signing);
 *      X402_CELO_FACILITATOR_API_KEY (Celo facilitator settle auth);
 *      facilitator URLs via config.ts
 */

import { createFacilitatorConfig } from "@coinbase/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import type { NetworkConfig, SettlementLane } from "@/lib/x402/networks";
import { getArcFacilitator } from "@/lib/x402/arc/arcFacilitator";
import {
  DEFAULT_FACILITATOR_URL,
  getHostedFacilitatorUrl,
} from "@/lib/x402/config";

/**
 * The two operations facilitator.ts asks of a facilitator, whether it is
 * reached over HTTP or runs in this process.
 *
 * Structural on purpose: HTTPFacilitatorClient satisfies it, and so does the
 * in-process ExactEvmScheme the Arc lane runs (its verify and settle take
 * two extra optional parameters, which a two-argument call ignores). That
 * keeps verifyPayment and settlePayment identical for every network.
 */
export interface X402FacilitatorClient {
  verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse>;
  settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse>;
  /**
   * Optional: only a hosted facilitator advertises what it supports. The
   * in-process Arc scheme has nothing to advertise to itself, and the one
   * caller (solana/feePayer.ts) asks a hosted facilitator by construction.
   */
  getSupported?(): Promise<SupportedResponse>;
}

const facilitatorClientsByLane = new Map<SettlementLane, X402FacilitatorClient>();

/**
 * Facilitator client for the given network, built once per lane.
 *
 * Throws on missing credentials for any lane; every caller catches and maps
 * the throw to facilitator_error before anything settles, so a
 * misconfigured lane fails closed.
 */
export function getFacilitatorClient(
  network: NetworkConfig,
): X402FacilitatorClient {
  const cachedClient = facilitatorClientsByLane.get(network.settlement);
  if (cachedClient) return cachedClient;

  const client = createFacilitatorClient(network);
  facilitatorClientsByLane.set(network.settlement, client);
  return client;
}

/**
 * Celo: plain HTTP client. Its /settle needs an X-API-Key (prepaid credits)
 * while /verify and /supported are open (probed live 2026-07-16), so the key
 * is attached to settle only, and a missing key throws here, before any
 * verify, instead of failing after the payer already signed.
 *
 * CDP: the hosted facilitator 401s without CDP API-key JWTs, so the default
 * URL always gets createFacilitatorConfig. A custom X402_FACILITATOR_URL gets
 * a plain client because those JWTs are signed for the CDP host.
 *
 * arc_local: no HTTP at all; the exact scheme runs in process over the Arc
 * operations key (arc/arcFacilitator.ts).
 */
function createFacilitatorClient(network: NetworkConfig): X402FacilitatorClient {
  switch (network.settlement) {
    case "arc_local":
      return getArcFacilitator();

    case "celo": {
      const celoApiKey = process.env.X402_CELO_FACILITATOR_API_KEY;
      if (!celoApiKey) {
        throw new Error(
          "[getFacilitatorClient] X402_CELO_FACILITATOR_API_KEY is required to " +
            "settle on the Celo facilitator (create one at https://x402.celo.org " +
            "with the payTo wallet). Set it, or remove celo from the request.",
        );
      }
      return new HTTPFacilitatorClient({
        url: getHostedFacilitatorUrl("celo"),
        createAuthHeaders: async () => ({
          verify: {},
          settle: { "X-API-Key": celoApiKey },
          supported: {},
        }),
      });
    }

    case "coinbase_cdp": {
      const facilitatorUrl = getHostedFacilitatorUrl("coinbase_cdp");
      if (facilitatorUrl !== DEFAULT_FACILITATOR_URL) {
        return new HTTPFacilitatorClient({ url: facilitatorUrl });
      }
      if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
        throw new Error(
          "[getFacilitatorClient] CDP_API_KEY_ID / CDP_API_KEY_SECRET are required " +
            "to call the CDP hosted facilitator. Set them, or point " +
            "X402_FACILITATOR_URL at a facilitator that needs no auth.",
        );
      }
      // createFacilitatorConfig returns { url: <CDP url>, createAuthHeaders }.
      return new HTTPFacilitatorClient(createFacilitatorConfig());
    }

    default: {
      const unhandledLane: never = network.settlement;
      throw new Error(`[getFacilitatorClient] Unhandled settlement lane: ${String(unhandledLane)}`);
    }
  }
}
