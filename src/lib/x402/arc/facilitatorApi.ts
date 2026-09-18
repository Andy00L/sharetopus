import "server-only";

/**
 * Shared logic behind the public Arc facilitator
 * (/api/x402/facilitator/{supported,verify,settle}).
 *
 * Arc is the one network where no hosted facilitator moves a plain EIP-3009
 * authorization from an agent's own wallet, so Sharetopus built one for
 * itself (arc/arcFacilitator.ts). This module exposes it to other Arc
 * builders over the standard x402 facilitator wire protocol, so a resource
 * server can point at it the way it would point at any other facilitator.
 *
 * Who pays for what: /supported and /verify are open, because they only
 * read the chain. /settle broadcasts, and on Arc the broadcaster pays the
 * gas out of its own USDC, so it is gated on a key issued by hand.
 *
 * Called by: src/app/api/x402/facilitator/*
 * Tables touched: none
 * Env: X402_FACILITATOR_SETTLE_KEY (settle access), plus the Arc operations
 *      key and RPC read through arc/arcChain.ts
 */

// The v2 schemas specifically: the generic ones also accept v1 shapes, and
// this facilitator speaks v2 only, so a v1 payload should fail the parse
// rather than reach a scheme that cannot read it.
import {
  PaymentPayloadV2Schema,
  PaymentRequirementsV2Schema,
} from "@x402/core/schemas";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

import { loadArcOperationsAccount } from "@/lib/x402/arc/arcChain";
import { getFacilitatorClient } from "@/lib/x402/facilitatorClient";
import type { X402FacilitatorClient } from "@/lib/x402/facilitatorClient";
import { getNetworkConfig } from "@/lib/x402/networks";
import type { NetworkConfig } from "@/lib/x402/networks";
import { timingSafeEqualSecret } from "@/lib/utils/timingSafeEqualSecret";

/** The only network this facilitator serves. sourceRef: networks.ts */
export const FACILITATED_NETWORK_NAME = "arc";

/** Protocol version this facilitator speaks. */
const X402_VERSION = 2;

/** Header carrying the settle key, matching the Celo facilitator's convention. */
export const SETTLE_KEY_HEADER = "x-api-key";

// ---------------------------------------------------------------------------
// Network and scheme
// ---------------------------------------------------------------------------

export type FacilitatedNetworkResult =
  | { ok: true; network: NetworkConfig; facilitator: X402FacilitatorClient }
  | { ok: false; httpStatus: number; message: string };

/**
 * The Arc network config plus its in-process facilitator.
 *
 * Fails closed with a 503 when the operations key is missing rather than
 * letting the throw escape: a caller deserves to know the facilitator is
 * unconfigured, not to read a stack trace.
 */
export function resolveFacilitatedNetwork(): FacilitatedNetworkResult {
  const network = getNetworkConfig(FACILITATED_NETWORK_NAME);
  if (!network) {
    return {
      ok: false,
      httpStatus: 503,
      message: "Arc is not in this deployment's network registry.",
    };
  }
  const accountResult = loadArcOperationsAccount();
  if (!accountResult.ok) {
    console.error(`[resolveFacilitatedNetwork] ${accountResult.message}`);
    return {
      ok: false,
      httpStatus: 503,
      message: "This facilitator is not configured to sign on Arc right now.",
    };
  }
  return { ok: true, network, facilitator: getFacilitatorClient(network) };
}

/** The kinds advertised on /supported, with the signer that broadcasts them. */
export function buildSupportedResponse(network: NetworkConfig, signerAddress: string) {
  return {
    kinds: [
      {
        x402Version: X402_VERSION,
        scheme: "exact",
        network: network.caipNetwork,
      },
    ],
    extensions: [],
    // Keyed by CAIP namespace, the shape the x402 client parses.
    signers: { eip155: [signerAddress] },
  };
}

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------

export type FacilitatorRequestResult =
  | {
      ok: true;
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    }
  | { ok: false; httpStatus: number; message: string };

/**
 * Parses and validates a verify or settle body.
 *
 * The one parse boundary for this API: the protocol's own zod schemas do
 * the shape checking, and the network is pinned to Arc here so a caller
 * cannot ask this facilitator to settle on a chain it holds no key for.
 */
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

  // The exact scheme signs an EIP-712 authorization over the USDC contract's
  // domain, which travels in extra as name and version. Requirements without
  // it could not have produced a signature this facilitator can check, so
  // they are refused here rather than deeper in the scheme.
  const requirementsExtra = requirements.extra;
  if (!requirementsExtra) {
    return {
      ok: false,
      httpStatus: 422,
      message:
        "paymentRequirements.extra must carry the USDC EIP-712 domain (name and version) for the exact scheme.",
    };
  }

  // The zod schemas type network as a plain string while the protocol types
  // it as a CAIP pair. Both were just proven equal to the registry's own
  // value, so substituting it narrows the type without a cast and without
  // changing what was validated.
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
      // The schema admits an explicit null where the protocol type says
      // "absent"; they mean the same thing here.
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

// ---------------------------------------------------------------------------
// Settle access
// ---------------------------------------------------------------------------

export type SettleAccessResult =
  | { ok: true }
  | { ok: false; httpStatus: number; message: string };

/**
 * Gate on /settle.
 *
 * Settling broadcasts a transaction whose gas comes out of this operator's
 * USDC, so the door is closed by default: no configured key means nobody
 * but this deployment's own routes may settle here. Keys are compared in
 * constant time, because a plain equality leaks the prefix through timing.
 */
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
