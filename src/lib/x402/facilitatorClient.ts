import "server-only";

/**
 * Lazy singleton HTTP client for the x402 facilitator. Extracted verbatim
 * from facilitator.ts (June 2026) so solana/feePayer.ts can reuse the same
 * client without the import cycle facilitator.ts -> http/paymentHttp.ts ->
 * solana/feePayer.ts -> facilitator.ts.
 *
 * Called by: facilitator.ts (verify/settle), solana/feePayer.ts (getSupported)
 * Tables touched: none
 * Env: CDP_API_KEY_ID, CDP_API_KEY_SECRET (CDP JWT signing); facilitator URL
 *      via config.ts
 */

import { createFacilitatorConfig } from "@coinbase/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { DEFAULT_FACILITATOR_URL, getFacilitatorUrl } from "@/lib/x402/config";

let facilitatorClientInstance: HTTPFacilitatorClient | null = null;

/**
 * Lazy singleton facilitator client. The CDP hosted facilitator (the
 * default) 401s without CDP API-key JWTs, so that path always wires
 * createFacilitatorConfig (which reads CDP_API_KEY_ID/CDP_API_KEY_SECRET
 * from env). A custom X402_FACILITATOR_URL gets a plain client because the
 * CDP JWTs are signed for the CDP host and would be meaningless elsewhere.
 * Throws on missing CDP keys for the CDP path; callers catch and map to
 * facilitator_error (fail closed).
 */
export function getFacilitatorClient(): HTTPFacilitatorClient {
  if (facilitatorClientInstance) return facilitatorClientInstance;

  const facilitatorUrl = getFacilitatorUrl();
  if (facilitatorUrl === DEFAULT_FACILITATOR_URL) {
    if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
      throw new Error(
        "[getFacilitatorClient] CDP_API_KEY_ID / CDP_API_KEY_SECRET are required " +
          "to call the CDP hosted facilitator. Set them, or point " +
          "X402_FACILITATOR_URL at a facilitator that needs no auth."
      );
    }
    // createFacilitatorConfig returns { url: <CDP url>, createAuthHeaders }.
    facilitatorClientInstance = new HTTPFacilitatorClient(
      createFacilitatorConfig()
    );
  } else {
    facilitatorClientInstance = new HTTPFacilitatorClient({
      url: facilitatorUrl,
    });
  }
  return facilitatorClientInstance;
}
