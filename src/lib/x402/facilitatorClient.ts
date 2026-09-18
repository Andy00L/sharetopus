import "server-only";

/**
 * Per-facilitator HTTP clients for the x402 protocol. Extracted from
 * facilitator.ts (June 2026) so solana/feePayer.ts can reuse the same
 * client without the import cycle facilitator.ts -> http/paymentHttp.ts ->
 * solana/feePayer.ts -> facilitator.ts. Became a per-family map in July
 * 2026 when Celo joined: Celo settles through x402.celo.org while every
 * other network stays on the CDP-configured facilitator.
 *
 * Called by: facilitator.ts (verify/settle), solana/feePayer.ts (getSupported)
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
import type { NetworkConfig } from "@/lib/x402/networks";
import { getArcFacilitator } from "@/lib/x402/arc/arcFacilitator";
import { DEFAULT_FACILITATOR_URL, getFacilitatorUrl } from "@/lib/x402/config";

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

/**
 * One lazily created client per facilitator family. Keyed by family, not
 * URL, because auth wiring follows the family: pointing both env URLs at
 * one host must still produce two clients with their own auth headers.
 */
type FacilitatorFamily = "arc" | "celo" | "default";
const facilitatorClientsByFamily = new Map<
  FacilitatorFamily,
  X402FacilitatorClient
>();

/**
 * Facilitator client for the given network.
 *
 * Celo: plain HTTP client against the Celo facilitator. Its /settle
 * requires an X-API-Key (prepaid credits; 1 credit = 1 settlement) while
 * /verify and /supported are open (probed live 2026-07-16), so the key is
 * attached to settle only and a missing key throws here, before any
 * verify, instead of failing after the payer already signed.
 *
 * Default (base/polygon/arbitrum/solana): the CDP hosted facilitator 401s
 * without CDP API-key JWTs, so that path always wires
 * createFacilitatorConfig (reads CDP_API_KEY_ID/CDP_API_KEY_SECRET from
 * env). A custom X402_FACILITATOR_URL gets a plain client because the CDP
 * JWTs are signed for the CDP host and would be meaningless elsewhere.
 *
 * Arc: no HTTP at all. No hosted facilitator settles a plain EIP-3009
 * authorization from an agent's own wallet there, so Sharetopus runs the
 * exact scheme in process over its own Arc key (arc/arcFacilitator.ts).
 *
 * Throws on missing credentials for any family; callers catch and map
 * to facilitator_error (fail closed).
 */
export function getFacilitatorClient(
  network: NetworkConfig
): X402FacilitatorClient {
  const family = resolveFacilitatorFamily(network);
  const cachedClient = facilitatorClientsByFamily.get(family);
  if (cachedClient) return cachedClient;

  if (family === "arc") {
    const arcFacilitator = getArcFacilitator(network);
    facilitatorClientsByFamily.set(family, arcFacilitator);
    return arcFacilitator;
  }

  const facilitatorUrl = getFacilitatorUrl(network);
  let client: HTTPFacilitatorClient;

  if (family === "celo") {
    const celoApiKey = process.env.X402_CELO_FACILITATOR_API_KEY;
    if (!celoApiKey) {
      throw new Error(
        "[getFacilitatorClient] X402_CELO_FACILITATOR_API_KEY is required to " +
          "settle on the Celo facilitator (create one at https://x402.celo.org " +
          "with the payTo wallet). Set it, or remove celo from the request."
      );
    }
    client = new HTTPFacilitatorClient({
      url: facilitatorUrl,
      createAuthHeaders: async () => ({
        verify: {},
        settle: { "X-API-Key": celoApiKey },
        supported: {},
      }),
    });
  } else if (facilitatorUrl === DEFAULT_FACILITATOR_URL) {
    if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
      throw new Error(
        "[getFacilitatorClient] CDP_API_KEY_ID / CDP_API_KEY_SECRET are required " +
          "to call the CDP hosted facilitator. Set them, or point " +
          "X402_FACILITATOR_URL at a facilitator that needs no auth."
      );
    }
    // createFacilitatorConfig returns { url: <CDP url>, createAuthHeaders }.
    client = new HTTPFacilitatorClient(createFacilitatorConfig());
  } else {
    client = new HTTPFacilitatorClient({ url: facilitatorUrl });
  }

  facilitatorClientsByFamily.set(family, client);
  return client;
}

/** Which facilitator implementation serves this network. */
function resolveFacilitatorFamily(network: NetworkConfig): FacilitatorFamily {
  if (network.name === "arc") return "arc";
  if (network.name === "celo") return "celo";
  return "default";
}
