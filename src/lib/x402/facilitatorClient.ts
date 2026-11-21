import "server-only";

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
import { withTimeout } from "@/lib/x402/http/withTimeout";

const FACILITATOR_VERIFY_TIMEOUT_MS = 15_000;
const FACILITATOR_SETTLE_TIMEOUT_MS = 30_000;
const FACILITATOR_SUPPORTED_TIMEOUT_MS = 10_000;

export interface X402FacilitatorClient {
  verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse>;
  settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse>;
  getSupported?(): Promise<SupportedResponse>;
}

const facilitatorClientsByLane = new Map<SettlementLane, X402FacilitatorClient>();

export type FacilitatorClientResult =
  | { ok: true; client: X402FacilitatorClient }
  | { ok: false; message: string };

export function getFacilitatorClient(network: NetworkConfig): FacilitatorClientResult {
  const cachedClient = facilitatorClientsByLane.get(network.settlement);
  if (cachedClient) return { ok: true, client: cachedClient };

  const clientResult = createFacilitatorClient(network);
  if (clientResult.ok) facilitatorClientsByLane.set(network.settlement, clientResult.client);
  return clientResult;
}

function createFacilitatorClient(network: NetworkConfig): FacilitatorClientResult {
  switch (network.settlement) {
    case "arc_local": {
      const arcResult = getArcFacilitator();
      return arcResult.ok ? { ok: true, client: arcResult.facilitator } : arcResult;
    }

    case "celo": {
      const celoApiKey = process.env.X402_CELO_FACILITATOR_API_KEY;
      if (!celoApiKey) {
        return {
          ok: false,
          message:
            "X402_CELO_FACILITATOR_API_KEY is required to settle on the Celo facilitator " +
            "(create one at https://x402.celo.org with the payTo wallet). Set it, or remove celo from the request.",
        };
      }
      return {
        ok: true,
        client: withHostedFacilitatorLimits(
          new HTTPFacilitatorClient({
            url: getHostedFacilitatorUrl("celo"),
            // Celo's facilitator gates /settle on X-API-Key (docs.celo.org/build-on-celo/build-with-ai/x402).
            createAuthHeaders: async () => ({
              verify: {},
              settle: { "X-API-Key": celoApiKey },
              supported: {},
            }),
          }),
        ),
      };
    }

    case "coinbase_cdp": {
      const facilitatorUrl = getHostedFacilitatorUrl("coinbase_cdp");
      // @coinbase/x402 createFacilitatorConfig signs its JWTs for the api.cdp.coinbase.com host only.
      if (facilitatorUrl !== DEFAULT_FACILITATOR_URL) {
        return { ok: true, client: withHostedFacilitatorLimits(new HTTPFacilitatorClient({ url: facilitatorUrl })) };
      }
      if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
        return {
          ok: false,
          message:
            "CDP_API_KEY_ID / CDP_API_KEY_SECRET are required to call the CDP hosted facilitator. " +
            "Set them, or point X402_FACILITATOR_URL at a facilitator that needs no auth.",
        };
      }
      return { ok: true, client: withHostedFacilitatorLimits(new HTTPFacilitatorClient(createFacilitatorConfig())) };
    }

    default: {
      const unhandledLane: never = network.settlement;
      return { ok: false, message: `Unhandled settlement lane: ${String(unhandledLane)}` };
    }
  }
}

/**
 * HTTPFacilitatorClient fetches with no timeout, and on a non-2xx reply whose
 * body is a VerifyResponse or SettleResponse it throws VerifyError or
 * SettleError instead of returning the body.
 * sourceRef: @x402/core 2.14.0 dist/esm/chunk-W4OPBTK7.mjs (HTTPFacilitatorClient verify and settle).
 */
function withHostedFacilitatorLimits(client: HTTPFacilitatorClient): X402FacilitatorClient {
  return {
    async verify(paymentPayload, paymentRequirements) {
      try {
        return await withTimeout(
          client.verify(paymentPayload, paymentRequirements),
          FACILITATOR_VERIFY_TIMEOUT_MS,
          `Facilitator verify at ${client.url}`,
        );
      } catch (error) {
        const rejection = readVerifyRejection(error);
        if (rejection) return rejection;
        throw error;
      }
    },

    async settle(paymentPayload, paymentRequirements) {
      try {
        return await withTimeout(
          client.settle(paymentPayload, paymentRequirements),
          FACILITATOR_SETTLE_TIMEOUT_MS,
          `Facilitator settle at ${client.url}`,
        );
      } catch (error) {
        const rejection = readSettleRejection(error, paymentRequirements);
        if (rejection) return rejection;
        throw error;
      }
    },

    getSupported() {
      return withTimeout(
        client.getSupported(),
        FACILITATOR_SUPPORTED_TIMEOUT_MS,
        `Facilitator /supported at ${client.url}`,
      );
    },
  };
}

/**
 * The VerifyResponse carried by a VerifyError. Matched by name and fields, not
 * instanceof: the CJS build of @x402/core defines the class once per entry
 * point, so the class this module could import is not always the one thrown.
 */
function readVerifyRejection(error: unknown): VerifyResponse | null {
  if (!(error instanceof Error) || error.name !== "VerifyError") return null;
  return {
    isValid: false,
    invalidReason:
      "invalidReason" in error && typeof error.invalidReason === "string" ? error.invalidReason : undefined,
    invalidMessage:
      "invalidMessage" in error && typeof error.invalidMessage === "string" ? error.invalidMessage : undefined,
    payer: "payer" in error && typeof error.payer === "string" ? error.payer : undefined,
  };
}

function readSettleRejection(
  error: unknown,
  paymentRequirements: PaymentRequirements,
): SettleResponse | null {
  if (!(error instanceof Error) || error.name !== "SettleError") return null;
  return {
    success: false,
    errorReason:
      "errorReason" in error && typeof error.errorReason === "string" ? error.errorReason : undefined,
    errorMessage:
      "errorMessage" in error && typeof error.errorMessage === "string" ? error.errorMessage : undefined,
    payer: "payer" in error && typeof error.payer === "string" ? error.payer : undefined,
    transaction:
      "transaction" in error && typeof error.transaction === "string" ? error.transaction : "",
    network: paymentRequirements.network,
  };
}
