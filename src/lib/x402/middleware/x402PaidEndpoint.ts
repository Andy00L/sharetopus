import "server-only";

import { after, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

import { encodePaymentResponseHeader } from "@x402/core/http";
import type { SettleResponse } from "@x402/core/types";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { extractIpHash, extractUserAgent } from "@/lib/api/context";
import type { Json } from "@/db/schema";
import type { PreflightResult } from "@/lib/types/preflight";
import { logX402Call, type X402AuditEntry } from "@/lib/x402/audit/logX402Call";
import { resolveOrOnboardWalletPrincipal } from "@/lib/x402/auth/resolveOrOnboardWalletPrincipal";
import type { WalletPrincipal } from "@/lib/x402/auth/types";
import {
  refundCharge,
  settleCharge,
  updateChargeRecord,
  type ChargeReplay,
} from "@/lib/x402/charges/chargeLifecycle";
import { markChargeFailed } from "@/lib/x402/charges/chargeTransitions";
import { getBaseUrl } from "@/lib/x402/config";
import {
  verifyPayment,
  type SettlePaymentError,
  type VerifyPaymentError,
} from "@/lib/x402/facilitator";
import { buildPaymentRequired, readPaymentHeader } from "@/lib/x402/http/paymentHttp";
import { describeRateLimitRejection } from "@/lib/x402/http/rateLimitRejection";
import { resolveRequestNetwork } from "@/lib/x402/http/resolveRequestNetwork";
import type { NetworkConfig } from "@/lib/x402/networks";
import { readActionPrice } from "@/lib/x402/pricing/readActionPrice";
import { buildGenericErrorResponse } from "@/lib/x402/responses/buildErrorResponse";
import { buildPaymentRequiredResponse } from "@/lib/x402/responses/buildPaymentRequiredResponse";
import { buildGenericSuccessResponse } from "@/lib/x402/responses/buildSuccessResponse";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Resolves the pricing_actions key for this request.
 * Most routes return a constant. post-now/schedule resolve from body.
 */
export type ActionResolver<TBody> = (
  body: TBody,
) =>
  | { success: true; action: string }
  | { success: false; httpStatus: number; errorKind: string; message: string };

/**
 * A business rule checked BEFORE any money moves: ownership, eligibility,
 * quotas, duplicate idempotency keys. A rejection here costs the caller
 * nothing and costs Sharetopus no settlement fee or refund gas. It runs
 * after verify, because the rule usually depends on who is paying.
 */
export type X402Precheck<TBody> = (params: {
  body: TBody;
  principal: WalletPrincipal;
  network: NetworkConfig;
}) => Promise<PreflightResult>;

export type X402HandlerResult<TResult> =
  | {
      success: true;
      data: TResult;
      /** Extra metadata stored on the charge (e.g. post-now's batch_id). */
      chargeMetadata?: { [key: string]: Json | undefined };
    }
  | { success: false; errorKind: string; message: string; refundable: boolean };

/**
 * Business logic called AFTER payment is settled and the charge row reached
 * status="settled". Returns the response body on success, or a typed error
 * for the refund path.
 */
export type X402Handler<TBody, TResult> = (params: {
  body: TBody;
  principal: WalletPrincipal;
  chargeId: string;
  requestId: string;
}) => Promise<X402HandlerResult<TResult>>;

export interface X402PaidEndpointOptions<TBody, TResult> {
  /** Endpoint path for logging and resource URL (e.g. "/api/x402/post-now"). */
  endpointPath: string;

  /** Action resolver. Maps the parsed body to a pricing_actions key. */
  resolveAction: ActionResolver<TBody>;

  /**
   * pricing_actions key used to price the 402 challenge when an UNPAID
   * request carries a body that does not parse or resolve. A2MCP
   * marketplace validators (OKX) probe registered endpoints with empty
   * bodies and expect the standard 402 challenge, not a 400; the x402
   * ordering is payment-first. Paid requests keep strict validation: an
   * invalid body with a payment header is still a 400 before any
   * verify/settle, so nobody is charged for a request that cannot run.
   */
  defaultAction: string;

  /**
   * Parse and validate the request body (POST: JSON, GET: query params).
   * Returns typed body on success or an error tuple on validation failure.
   */
  parseBody: (req: NextRequest) => Promise<
    | { success: true; data: TBody }
    | { success: false; httpStatus: number; errorKind: string; message: string }
  >;

  /** Optional business-rule check that runs before settlement. */
  precheck?: X402Precheck<TBody>;

  /** Business logic handler called after payment is settled. */
  handler: X402Handler<TBody, TResult>;

  /** Rate limit scope identifier (e.g. "x402:post-now"). */
  rateLimitScope: string;

  /** Max requests per minute per IP for this endpoint. */
  rateLimitPerMinute: number;
}

// ---------------------------------------------------------------------------
// Request context (audit + error responses)
// ---------------------------------------------------------------------------

type AuditStatus = X402AuditEntry["resultStatus"];

interface FailureParams {
  principal: WalletPrincipal | null;
  action: string | null;
  chargeId: string | null;
  resultStatus: AuditStatus;
  httpStatus: number;
  errorKind: string;
  message: string;
  retryAfterSeconds?: number;
  refundInitiated?: boolean;
  refundTxHash?: string | null;
}

interface RequestContext {
  endpointPath: string;
  audit: (entry: {
    principal: WalletPrincipal | null;
    action: string | null;
    chargeId: string | null;
    resultStatus: AuditStatus;
  }) => void;
  fail: (params: FailureParams) => Response;
}

/**
 * Per-request audit and failure helpers. Audit rows are written after the
 * response is sent (next/server after()), so logging never adds a database
 * round trip to the paid path's latency.
 */
async function createRequestContext(endpointPath: string): Promise<RequestContext> {
  const startMs = performance.now();
  const ipHash = await extractIpHash();
  const userAgent = await extractUserAgent();

  const audit: RequestContext["audit"] = (entry) => {
    const auditEntry: X402AuditEntry = {
      ...entry,
      endpoint: endpointPath,
      latencyMs: Math.round(performance.now() - startMs),
      ipHash,
      userAgent,
    };
    after(() => logX402Call(auditEntry));
  };

  const fail: RequestContext["fail"] = (params) => {
    audit({
      principal: params.principal,
      action: params.action,
      chargeId: params.chargeId,
      resultStatus: params.resultStatus,
    });
    return buildGenericErrorResponse({
      httpStatus: params.httpStatus,
      errorKind: params.errorKind,
      message: params.message,
      retryAfterSeconds: params.retryAfterSeconds,
      refundInitiated: params.refundInitiated,
      refundTxHash: params.refundTxHash,
      chargeId: params.chargeId,
    });
  };

  return { endpointPath, audit, fail };
}

// ---------------------------------------------------------------------------
// Shared preparation: rate limit, network, price
// ---------------------------------------------------------------------------

type PreparedRequest =
  | { ok: true; network: NetworkConfig; recipientAddress: string; usdcPrice: number }
  | { ok: false; response: Response };

async function prepareRequest(params: {
  req: NextRequest;
  action: string;
  rateLimitScope: string;
  rateLimitPerMinute: number;
  context: RequestContext;
}): Promise<PreparedRequest> {
  const { context, action } = params;

  const rateLimitResult = await checkRateLimit(
    params.rateLimitScope,
    null,
    params.rateLimitPerMinute,
    60,
  );
  if (!rateLimitResult.success) {
    const rejection = describeRateLimitRejection(rateLimitResult);
    return {
      ok: false,
      response: context.fail({
        principal: null,
        action,
        chargeId: null,
        resultStatus: rejection.auditStatus,
        httpStatus: rejection.httpStatus,
        errorKind: rejection.errorKind,
        message: rejection.message,
        retryAfterSeconds: rejection.retryAfterSeconds,
      }),
    };
  }

  const networkResult = resolveRequestNetwork(params.req.url);
  if (!networkResult.ok) {
    const isUnsupported = networkResult.reason === "unsupported_network";
    return {
      ok: false,
      response: context.fail({
        principal: null,
        action,
        chargeId: null,
        resultStatus: "error",
        httpStatus: isUnsupported ? 400 : 500,
        errorKind: isUnsupported ? "unsupported_network" : "server_misconfiguration",
        message: networkResult.message,
      }),
    };
  }

  const priceResult = await readActionPrice(action);
  if (!priceResult.ok) {
    console.error(`[prepareRequest] Pricing lookup failed for "${action}": ${priceResult.message}`);
    // action: null because x402_access_log.action carries an FK to
    // pricing_actions and the row may not exist at all.
    return {
      ok: false,
      response: context.fail({
        principal: null,
        action: null,
        chargeId: null,
        resultStatus: "error",
        httpStatus: 500,
        errorKind: "pricing_not_configured",
        message: priceResult.message,
      }),
    };
  }

  return {
    ok: true,
    network: networkResult.network,
    recipientAddress: networkResult.recipientAddress,
    usdcPrice: priceResult.usdcPrice,
  };
}

/** The 402 challenge for an unpaid request. */
async function buildChallengeResponse(params: {
  action: string;
  prepared: Extract<PreparedRequest, { ok: true }>;
  context: RequestContext;
}): Promise<Response> {
  const { action, prepared, context } = params;
  // A Solana 402 without extra.feePayer is unpayable by spec-compliant
  // clients, so a fee-payer outage returns 502 instead of an empty 402.
  const paymentRequiredResult = await buildPaymentRequired({
    resourceUrl: `${getBaseUrl()}${context.endpointPath}`,
    network: prepared.network,
    amountUsdc: prepared.usdcPrice,
    recipientAddress: prepared.recipientAddress,
    error: "PAYMENT-SIGNATURE header is required",
  });
  if (!paymentRequiredResult.ok) {
    return context.fail({
      principal: null,
      action,
      chargeId: null,
      resultStatus: "error",
      httpStatus: 502,
      errorKind: "facilitator_error",
      message: paymentRequiredResult.message,
    });
  }
  context.audit({ principal: null, action, chargeId: null, resultStatus: "402_required" });
  return buildPaymentRequiredResponse(paymentRequiredResult.paymentRequired);
}

// ---------------------------------------------------------------------------
// HOF: x402PaidEndpoint
// ---------------------------------------------------------------------------

/**
 * Higher-order function wrapping the x402 verify/settle/refund flow shared
 * by every paid endpoint except connect (which keeps its own response
 * contract but runs the same charge lifecycle, charges/chargeLifecycle.ts).
 *
 * Steps:
 *  1. Read the payment header (payment-first: unpaid requests are answered
 *     with a 402 challenge even when their body is invalid; see
 *     options.defaultAction).
 *  2. Parse body and resolve the action key. Invalid body or action with a
 *     payment header present: 400 before any verify/settle.
 *  3. Rate limit per IP; resolve the network and payout address; read the
 *     price.
 *  4. No payment header: 402 with the v2 PaymentRequired header + body.
 *  5. Verify the payment (off-chain).
 *  6. Resolve or onboard the wallet principal from the facilitator-recovered
 *     payer. Sanctioned wallets are rejected before any charge row.
 *  7. Precheck the business rules; a rejection costs nothing.
 *  8. Settle through the charge lifecycle: pending row first (a replay of
 *     the same payment gets the stored result back), then settle, then
 *     pending -> settled.
 *  9. Run the handler. A refundable failure refunds on-chain and records
 *     "refunded" only once the chain confirms it; a non-refundable failure
 *     marks the charge failed.
 * 10. Success: the result is stored on the charge for replay (write
 *     actions), and the response carries PAYMENT-RESPONSE.
 */
export function x402PaidEndpoint<TBody, TResult extends Json>(
  options: X402PaidEndpointOptions<TBody, TResult>,
): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest): Promise<Response> => {
    const requestId = randomUUID();
    const context = await createRequestContext(options.endpointPath);

    // Step 1: read the payment header before validating the body; x402 is
    // payment-first and marketplace validators probe with empty bodies.
    const paymentHeader = readPaymentHeader(req);

    // Step 2: parse body and resolve action. Unpaid requests fall back to
    // defaultAction for challenge pricing; the null parsedBody never
    // survives past the 402 return.
    let parsedBody: { data: TBody } | null = null;
    let actionKey: string = options.defaultAction;
    const bodyResult = await options.parseBody(req);
    if (bodyResult.success) {
      const actionResult = options.resolveAction(bodyResult.data);
      if (actionResult.success) {
        parsedBody = { data: bodyResult.data };
        actionKey = actionResult.action;
      } else if (paymentHeader) {
        return context.fail({
          principal: null,
          action: null,
          chargeId: null,
          resultStatus: "error",
          httpStatus: actionResult.httpStatus,
          errorKind: actionResult.errorKind,
          message: actionResult.message,
        });
      }
    } else if (paymentHeader) {
      return context.fail({
        principal: null,
        action: null,
        chargeId: null,
        resultStatus: "error",
        httpStatus: bodyResult.httpStatus,
        errorKind: bodyResult.errorKind,
        message: bodyResult.message,
      });
    }

    // Step 3: rate limit, network, price.
    const prepared = await prepareRequest({
      req,
      action: actionKey,
      rateLimitScope: options.rateLimitScope,
      rateLimitPerMinute: options.rateLimitPerMinute,
      context,
    });
    if (!prepared.ok) return prepared.response;
    const { network, recipientAddress, usdcPrice } = prepared;

    // Step 4: no payment header, answer with the challenge.
    if (!paymentHeader) {
      return buildChallengeResponse({ action: actionKey, prepared, context });
    }

    // A null parsedBody only exists on the unpaid path, which returned above;
    // this guard is a fail-closed invariant check, not control flow.
    if (parsedBody === null) {
      console.error("[x402PaidEndpoint] Invariant violation: paid path reached without a parsed body.");
      return context.fail({
        principal: null,
        action: actionKey,
        chargeId: null,
        resultStatus: "error",
        httpStatus: 500,
        errorKind: "internal_error",
        message: "Internal request-state error. No payment was taken.",
      });
    }
    const body = parsedBody.data;

    // Step 5: verify (off-chain).
    const verifyResult = await verifyPayment({
      paymentHeader,
      amountUsdc: usdcPrice,
      recipientAddress,
      network,
    });
    if (!verifyResult.ok) {
      const verifyError = verifyResult.error;
      return context.fail({
        principal: null,
        action: actionKey,
        chargeId: null,
        resultStatus: verifyError.kind === "kyt_sanctioned" ? "sanctioned" : "error",
        httpStatus: mapVerifyErrorToHttpStatus(verifyError.kind),
        errorKind: verifyError.kind,
        message: describeVerifyError(verifyError),
      });
    }

    // Step 6: resolve or onboard the wallet principal.
    const walletResult = await resolveOrOnboardWalletPrincipal({
      payerAddress: verifyResult.payerAddress,
      network,
    });
    if (!walletResult.ok) {
      if (walletResult.reason === "sanctioned") {
        return context.fail({
          principal: walletResult.principal,
          action: actionKey,
          chargeId: null,
          resultStatus: "sanctioned",
          httpStatus: 403,
          errorKind: "sanctioned",
          message: walletResult.message,
        });
      }
      return context.fail({
        principal: null,
        action: actionKey,
        chargeId: null,
        resultStatus: "error",
        httpStatus: 500,
        errorKind: "wallet_resolution_failed",
        message: walletResult.message,
      });
    }
    const principal = walletResult.principal;

    // Step 7: business rules, before any money moves.
    if (options.precheck) {
      const precheckResult = await options.precheck({ body, principal, network });
      if (!precheckResult.ok) {
        return context.fail({
          principal,
          action: actionKey,
          chargeId: null,
          resultStatus: "error",
          httpStatus: precheckResult.httpStatus,
          errorKind: precheckResult.errorKind,
          message: `${precheckResult.message} No payment was taken.`,
        });
      }
    }

    // Step 8: record, settle, finalize.
    const chargeResult = await settleCharge({
      paymentHeader,
      network,
      verified: verifyResult,
      principal,
      action: actionKey,
      amountUsdc: usdcPrice,
      requestId,
      recipientAddress,
    });
    if (!chargeResult.ok) {
      switch (chargeResult.reason) {
        case "replay":
          return respondToReplay({
            replay: chargeResult.replay,
            req,
            options,
            body,
            principal,
            network,
            usdcPrice,
            payerAddress: verifyResult.payerAddress,
            actionKey,
            requestId,
            context,
          });
        case "charge_insert_failed":
          return context.fail({
            principal,
            action: actionKey,
            chargeId: null,
            resultStatus: "error",
            httpStatus: 500,
            errorKind: "charge_insert_failed",
            message: `${chargeResult.message} No payment was taken.`,
          });
        case "settle_failed":
          return context.fail({
            principal,
            action: actionKey,
            chargeId: chargeResult.chargeId,
            resultStatus: "error",
            httpStatus: mapSettleErrorToHttpStatus(chargeResult.error.kind),
            errorKind: chargeResult.error.kind,
            message: chargeResult.error.message,
          });
        case "settled_unrecorded":
          return context.fail({
            principal,
            action: actionKey,
            chargeId: chargeResult.chargeId,
            resultStatus: "error",
            httpStatus: 500,
            errorKind: "charge_update_failed",
            message:
              "Payment settled but could not be recorded. It is queued for reconciliation; do not retry this payment.",
          });
        default: {
          const unhandledResult: never = chargeResult;
          console.error(`[x402PaidEndpoint] Unhandled charge result: ${JSON.stringify(unhandledResult)}`);
          return context.fail({
            principal,
            action: actionKey,
            chargeId: null,
            resultStatus: "error",
            httpStatus: 500,
            errorKind: "internal_error",
            message: "Internal payment-state error.",
          });
        }
      }
    }
    const { chargeId, txHash } = chargeResult;

    // Step 9: the paid action.
    const handlerResult = await runHandler(options.handler, { body, principal, chargeId, requestId });

    if (!handlerResult.success) {
      if (handlerResult.refundable) {
        const refundOutcome = await refundCharge({
          chargeId,
          settleTxHash: txHash,
          payerAddress: verifyResult.payerAddress,
          amountUsdc: usdcPrice,
          network,
          reason: handlerResult.message,
          principalId: principal.principalId,
        });
        return context.fail({
          principal,
          action: actionKey,
          chargeId,
          resultStatus: "error",
          httpStatus: 500,
          errorKind: handlerResult.errorKind,
          message: handlerResult.message,
          refundInitiated: refundOutcome.refundInitiated,
          refundTxHash: refundOutcome.refundTxHash,
        });
      }

      await markChargeFailed({
        chargeId,
        fromStatus: "settled",
        errorMessage: handlerResult.message,
      });
      return context.fail({
        principal,
        action: actionKey,
        chargeId,
        resultStatus: "error",
        httpStatus: 500,
        errorKind: handlerResult.errorKind,
        message: handlerResult.message,
      });
    }

    // Step 10: success. Write actions keep a replay copy of the result so a
    // client that lost this response can present the same payment again.
    const storedMetadata = {
      ...(handlerResult.chargeMetadata ?? {}),
      ...(req.method === "GET" ? {} : { result: handlerResult.data }),
    };
    if (Object.keys(storedMetadata).length > 0) {
      await updateChargeRecord(chargeId, { metadata: storedMetadata });
    }

    context.audit({ principal, action: actionKey, chargeId, resultStatus: "ok" });
    return buildSettledResponse({
      data: handlerResult.data,
      txHash,
      chargeId,
      network,
      payerAddress: verifyResult.payerAddress,
      usdcPrice,
    });
  };
}

// ---------------------------------------------------------------------------
// HOF: x402ChallengeGet
// ---------------------------------------------------------------------------

export interface X402ChallengeGetOptions {
  /** Endpoint path for logging and resource URL (e.g. "/api/x402/post-now"). */
  endpointPath: string;

  /** pricing_actions key used to price the challenge (the endpoint's representative action). */
  action: string;

  /** Rate limit scope identifier (shared with the POST handler is fine). */
  rateLimitScope: string;

  /** Max requests per minute per IP. */
  rateLimitPerMinute: number;
}

/**
 * Challenge-only GET handler for paid POST endpoints.
 *
 * A2MCP marketplace validators (OKX) probe registered endpoints with a bare
 * GET (curl -i) and require the standard x402 402 challenge
 * (PAYMENT-REQUIRED header, x402Version body). This handler always answers
 * 402 priced at options.action and never executes the paid action, even if
 * a payment header is sent: execution semantics live on POST only.
 *
 * Next.js derives HEAD from GET automatically, so curl -I probes are
 * covered by the same handler.
 */
export function x402ChallengeGet(
  options: X402ChallengeGetOptions,
): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest): Promise<Response> => {
    const context = await createRequestContext(options.endpointPath);
    const prepared = await prepareRequest({
      req,
      action: options.action,
      rateLimitScope: options.rateLimitScope,
      rateLimitPerMinute: options.rateLimitPerMinute,
      context,
    });
    if (!prepared.ok) return prepared.response;
    return buildChallengeResponse({ action: options.action, prepared, context });
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Runs the handler. Handlers return errors as values, but money has already
 * settled when this runs, so an unexpected throw must not escape: it is
 * converted into a refundable failure.
 */
async function runHandler<TBody, TResult>(
  handler: X402Handler<TBody, TResult>,
  params: { body: TBody; principal: WalletPrincipal; chargeId: string; requestId: string },
): Promise<X402HandlerResult<TResult>> {
  try {
    return await handler(params);
  } catch (err) {
    console.error(
      `[runHandler] Handler threw for charge ${params.chargeId}:`,
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      errorKind: "internal_error",
      message: "Unexpected error while executing the paid action.",
      refundable: true,
    };
  }
}

/** Success response with the PAYMENT-RESPONSE header (both generations). */
function buildSettledResponse(params: {
  data: Json;
  txHash: string;
  chargeId: string;
  network: NetworkConfig;
  payerAddress: string;
  usdcPrice: number;
}): Response {
  const settleResponse: SettleResponse = {
    success: true,
    payer: params.payerAddress,
    transaction: params.txHash,
    network: params.network.caipNetwork,
    amount: usdcToAtomic(params.usdcPrice, params.network.usdcDecimals),
  };
  return buildGenericSuccessResponse({
    data: params.data,
    txHash: params.txHash,
    network: params.network.name,
    payerAddress: params.payerAddress,
    chargeId: params.chargeId,
    paymentResponseHeader: encodePaymentResponseHeader(settleResponse),
  });
}

/**
 * Answers a payment that was already presented. A settled write action
 * returns its stored result; a settled read (GET) runs again, since reads
 * are safe to repeat and their results are not stored. Nothing here charges
 * or settles anything.
 */
async function respondToReplay<TBody, TResult extends Json>(params: {
  replay: ChargeReplay;
  req: NextRequest;
  options: X402PaidEndpointOptions<TBody, TResult>;
  body: TBody;
  principal: WalletPrincipal;
  network: NetworkConfig;
  usdcPrice: number;
  payerAddress: string;
  actionKey: string;
  requestId: string;
  context: RequestContext;
}): Promise<Response> {
  const { replay, context, principal, actionKey } = params;

  switch (replay.state) {
    case "in_progress":
      return context.fail({
        principal,
        action: actionKey,
        chargeId: replay.chargeId,
        resultStatus: "error",
        httpStatus: 409,
        errorKind: "payment_in_progress",
        message: "This payment is still being processed. Retry the same request in a few seconds.",
        retryAfterSeconds: 5,
      });

    case "closed":
      return context.fail({
        principal,
        action: actionKey,
        chargeId: replay.chargeId,
        resultStatus: "error",
        httpStatus: 409,
        errorKind: "replay_detected",
        message: "This payment has already been used.",
      });

    case "settled": {
      let replayData: Json | null = replay.storedResult;
      if (replayData === null && params.req.method === "GET") {
        const rerun = await runHandler(params.options.handler, {
          body: params.body,
          principal,
          chargeId: replay.chargeId,
          requestId: params.requestId,
        });
        if (!rerun.success) {
          return context.fail({
            principal,
            action: actionKey,
            chargeId: replay.chargeId,
            resultStatus: "error",
            httpStatus: 500,
            errorKind: rerun.errorKind,
            message: rerun.message,
          });
        }
        replayData = rerun.data;
      }
      if (replayData === null) {
        return context.fail({
          principal,
          action: actionKey,
          chargeId: replay.chargeId,
          resultStatus: "error",
          httpStatus: 409,
          errorKind: "replay_detected",
          message: "This payment was already used and its result is not stored for replay.",
        });
      }
      context.audit({ principal, action: actionKey, chargeId: replay.chargeId, resultStatus: "ok" });
      return buildSettledResponse({
        data: replayData,
        txHash: replay.txHash,
        chargeId: replay.chargeId,
        network: params.network,
        payerAddress: params.payerAddress,
        usdcPrice: params.usdcPrice,
      });
    }

    default: {
      const unhandledReplay: never = replay;
      console.error(`[respondToReplay] Unhandled replay state: ${JSON.stringify(unhandledReplay)}`);
      return context.fail({
        principal,
        action: actionKey,
        chargeId: null,
        resultStatus: "error",
        httpStatus: 409,
        errorKind: "replay_detected",
        message: "This payment has already been used.",
      });
    }
  }
}

/** Human-readable detail for a verify rejection. */
function describeVerifyError(error: VerifyPaymentError): string {
  switch (error.kind) {
    case "malformed_header":
    case "invalid_signature":
    case "invalid_payment":
    case "insufficient_funds":
    case "authorization_expired":
    case "facilitator_error":
      return error.message;
    case "amount_mismatch":
      return `Expected ${error.expected} USDC, the payment authorizes ${error.received} USDC.`;
    case "network_mismatch":
      return `Expected network ${error.expected}, the payment names ${error.received}.`;
    case "recipient_mismatch":
      return `Expected recipient ${error.expected}, the payment names ${error.received}.`;
    case "replay_detected":
      return `Payment nonce ${error.nonce} has already been used.`;
    case "kyt_sanctioned":
      return "The paying wallet is flagged by sanctions screening.";
    default: {
      const unhandledError: never = error;
      return `Payment verification failed (${JSON.stringify(unhandledError)}).`;
    }
  }
}

function mapVerifyErrorToHttpStatus(kind: VerifyPaymentError["kind"]): number {
  switch (kind) {
    case "malformed_header":
    case "invalid_signature":
    case "invalid_payment":
      return 400;
    case "amount_mismatch":
    case "network_mismatch":
    case "recipient_mismatch":
    case "insufficient_funds":
    case "authorization_expired":
      return 402;
    case "replay_detected":
      return 409;
    case "kyt_sanctioned":
      return 403;
    case "facilitator_error":
      return 502;
    default: {
      const unhandledKind: never = kind;
      console.error(`[mapVerifyErrorToHttpStatus] Unhandled kind: ${String(unhandledKind)}`);
      return 500;
    }
  }
}

function mapSettleErrorToHttpStatus(kind: SettlePaymentError["kind"]): number {
  switch (kind) {
    case "not_verified":
    case "insufficient_funds":
      return 402;
    case "facilitator_error":
      return 502;
    case "timeout":
      return 504;
    default: {
      const unhandledKind: never = kind;
      console.error(`[mapSettleErrorToHttpStatus] Unhandled kind: ${String(unhandledKind)}`);
      return 500;
    }
  }
}
