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
import type { NetworkConfig } from "@/lib/x402/networks";
import { DEFAULT_FACILITATOR_URL, getFacilitatorUrl } from "@/lib/x402/config";

/**
 * One lazily created client per facilitator family. Keyed by family, not
 * URL, because auth wiring follows the family: pointing both env URLs at
 * one host must still produce two clients with their own auth headers.
 */
type FacilitatorFamily = "celo" | "default";
const facilitatorClientsByFamily = new Map<
  FacilitatorFamily,
  HTTPFacilitatorClient
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
 * Throws on missing credentials for either family; callers catch and map
 * to facilitator_error (fail closed).
 */
export function getFacilitatorClient(
  network: NetworkConfig
): HTTPFacilitatorClient {
  const family: FacilitatorFamily =
    network.name === "celo" ? "celo" : "default";
  const cachedClient = facilitatorClientsByFamily.get(family);
  if (cachedClient) return cachedClient;

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
