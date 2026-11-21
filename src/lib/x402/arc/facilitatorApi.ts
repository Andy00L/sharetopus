import "server-only";

import {
  PaymentPayloadV2Schema,
  PaymentRequirementsV2Schema,
} from "@x402/core/schemas";
import type { PaymentPayload, PaymentRequirements, SupportedResponse } from "@x402/core/types";

import { getArcSigner } from "@/lib/x402/arc/arcChain";
import { getFacilitatorClient } from "@/lib/x402/facilitatorClient";
import type { X402FacilitatorClient } from "@/lib/x402/facilitatorClient";
import { NETWORKS } from "@/lib/x402/networks";
import type { NetworkConfig } from "@/lib/x402/networks";
import { timingSafeEqualSecret } from "@/lib/utils/timingSafeEqualSecret";

const FACILITATED_NETWORK = NETWORKS.arc;

const X402_VERSION = 2;

export const SETTLE_KEY_HEADER = "x-api-key";

// @x402/core keys /supported signers by the scheme's CAIP family, "eip155:*" for @x402/evm
// (node_modules/@x402/core/dist/esm/facilitator/index.mjs getSupported, @x402/evm ExactEvmScheme.caipFamily).
const EVM_SIGNERS_KEY = "eip155:*";

export type FacilitatedNetworkResult =
  | {
      ok: true;
      network: NetworkConfig;
      facilitator: X402FacilitatorClient;
      signerAddress: string;
    }
  | { ok: false; httpStatus: number; message: string };

export function resolveFacilitatedNetwork(): FacilitatedNetworkResult {
  const signerResult = getArcSigner();
  if (!signerResult.ok) {
    console.error(`[resolveFacilitatedNetwork] ${signerResult.message}`);
    return {
      ok: false,
      httpStatus: 503,
      message: "This facilitator is not configured to sign on Arc right now.",
    };
  }
  const facilitatorResult = getFacilitatorClient(FACILITATED_NETWORK);
  if (!facilitatorResult.ok) {
    console.error(`[resolveFacilitatedNetwork] ${facilitatorResult.message}`);
    return {
      ok: false,
      httpStatus: 503,
      message: "This facilitator is not configured to sign on Arc right now.",
    };
  }
  return {
    ok: true,
    network: FACILITATED_NETWORK,
    facilitator: facilitatorResult.client,
    signerAddress: signerResult.signer.account.address,
  };
}

export function buildSupportedResponse(network: NetworkConfig, signerAddress: string): SupportedResponse {
  return {
    kinds: [
      {
        x402Version: X402_VERSION,
        scheme: "exact",
        network: network.caipNetwork,
      },
    ],
    extensions: [],
    signers: { [EVM_SIGNERS_KEY]: [signerAddress] },
  };
}

export type FacilitatorRequestResult =
  | {
      ok: true;
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    }
  | { ok: false; httpStatus: number; message: string };

export async function readFacilitatorRequest(
  request: Request,
  network: NetworkConfig,
): Promise<FacilitatorRequestResult> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, httpStatus: 400, message: "Request body must be valid JSON." };
  }

  if (typeof body !== "object" || body === null) {
    return { ok: false, httpStatus: 400, message: "Request body must be a JSON object." };
  }
  if (!("paymentPayload" in body) || !("paymentRequirements" in body)) {
    return {
      ok: false,
      httpStatus: 400,
      message: "Request body must carry paymentPayload and paymentRequirements.",
    };
  }

  const payloadResult = PaymentPayloadV2Schema.safeParse(body.paymentPayload);
  if (!payloadResult.success) {
    return { ok: false, httpStatus: 400, message: "paymentPayload is not a valid x402 v2 payload." };
  }
  const requirementsResult = PaymentRequirementsV2Schema.safeParse(body.paymentRequirements);
  if (!requirementsResult.success) {
    return {
      ok: false,
      httpStatus: 400,
      message: "paymentRequirements is not a valid x402 v2 requirements object.",
    };
  }

  const requirements = requirementsResult.data;
  if (requirements.network !== network.caipNetwork) {
    return {
      ok: false,
      httpStatus: 422,
      message: `This facilitator only serves ${network.caipNetwork}; the requirements name ${requirements.network}.`,
    };
  }
  if (requirements.scheme !== "exact") {
    return {
      ok: false,
      httpStatus: 422,
      message: `This facilitator only serves the exact scheme; the requirements name ${requirements.scheme}.`,
    };
  }

  const requirementsExtra = requirements.extra;
  if (!requirementsExtra) {
    return {
      ok: false,
      httpStatus: 422,
      message:
        "paymentRequirements.extra must carry the USDC EIP-712 domain (name and version) for the exact scheme.",
    };
  }

  const payload = payloadResult.data;
  if (payload.accepted.network !== network.caipNetwork) {
    return {
      ok: false,
      httpStatus: 422,
      message: `The payload was signed for ${payload.accepted.network}, not ${network.caipNetwork}.`,
    };
  }
  const acceptedExtra = payload.accepted.extra;
  if (!acceptedExtra) {
    return {
      ok: false,
      httpStatus: 422,
      message:
        "paymentPayload.accepted.extra must carry the USDC EIP-712 domain the authorization was signed over.",
    };
  }

  return {
    ok: true,
    paymentPayload: {
      ...payload,
      extensions: payload.extensions ?? undefined,
      accepted: {
        ...payload.accepted,
        network: network.caipNetwork,
        extra: acceptedExtra,
      },
    },
    paymentRequirements: {
      ...requirements,
      network: network.caipNetwork,
      extra: requirementsExtra,
    },
  };
}

export type SettleAccessResult =
  | { ok: true }
  | { ok: false; httpStatus: number; message: string };

export function checkSettleAccess(request: Request): SettleAccessResult {
  const expectedKey = process.env.X402_FACILITATOR_SETTLE_KEY;
  if (!expectedKey) {
    return {
      ok: false,
      httpStatus: 403,
      message:
        "Settlement through this facilitator is not open. /supported and /verify are; ask the operator for a settle key, or run your own copy of this facilitator (src/lib/x402/arc).",
    };
  }

  const presentedKey = request.headers.get(SETTLE_KEY_HEADER);
  if (!presentedKey || !timingSafeEqualSecret(presentedKey, expectedKey)) {
    return {
      ok: false,
      httpStatus: 401,
      message: `A valid ${SETTLE_KEY_HEADER} header is required to settle.`,
    };
  }
  return { ok: true };
}
