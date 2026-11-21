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
  type ChargeMetadata,
  type ChargeRecordFields,
  type ChargeReplay,
} from "@/lib/x402/charges/chargeLifecycle";
import { getBaseUrl } from "@/lib/x402/config";
import {
  verifyPayment,
  type SettlePaymentError,
  type VerifiedPayment,
  type VerifyPaymentError,
} from "@/lib/x402/facilitator";
import { buildPaymentRequired, readPaymentHeader } from "@/lib/x402/http/paymentHttp";
import { describeRateLimitRejection } from "@/lib/x402/http/rateLimitRejection";
import { resolveRequestNetwork } from "@/lib/x402/http/resolveRequestNetwork";
import {
  KEY_RESERVATION_TTL_MS,
  reserveIdempotencyKey,
} from "@/lib/x402/middleware/idempotencyKeyReservation";
import type { NetworkConfig } from "@/lib/x402/networks";
import {
  readActionPrice,
  type PurchasableX402Action,
} from "@/lib/x402/pricing/readActionPrice";
import { buildGenericErrorResponse } from "@/lib/x402/responses/buildErrorResponse";
import { buildPaymentRequiredResponse } from "@/lib/x402/responses/buildPaymentRequiredResponse";
import { buildGenericSuccessResponse } from "@/lib/x402/responses/buildSuccessResponse";

const RATE_LIMIT_WINDOW_SECONDS = 60;
const KEY_IN_PROGRESS_RETRY_AFTER_SECONDS = 5;
const KEY_CHECK_UNAVAILABLE_RETRY_AFTER_SECONDS = 60;
const REPLAY_RETRY_AFTER_SECONDS = 5;

export type ActionResolver<TBody> = (
  body: TBody,
) =>
  | { success: true; action: PurchasableX402Action }
  | { success: false; httpStatus: number; errorKind: string; message: string };

export type X402Precheck<TBody> = (params: {
  body: TBody;
  principal: WalletPrincipal;
  network: NetworkConfig;
}) => Promise<PreflightResult>;

export type X402HandlerResult<TResult> =
  | {
      success: true;
      data: TResult;
      chargeRecord?: ChargeRecordFields;
    }
  | { success: false; errorKind: string; message: string };

export type X402Handler<TBody, TResult> = (params: {
  body: TBody;
  principal: WalletPrincipal;
  chargeId: string;
  requestId: string;
}) => Promise<X402HandlerResult<TResult>>;

export type RecoveredReplayResult =
  | { kind: "recovered"; data: Json }
  | { kind: "not_found" }
  | { kind: "lookup_failed"; message: string };

export type ReplayResultRecovery = (params: {
  principal: WalletPrincipal;
  chargeId: string;
  storedMetadata: ChargeMetadata;
}) => Promise<RecoveredReplayResult>;

export interface X402PaidEndpointOptions<TBody, TResult> {
  endpointPath: string;

  resolveAction: ActionResolver<TBody>;

  defaultAction: PurchasableX402Action;

  parseBody: (req: NextRequest) => Promise<
    | { success: true; data: TBody }
    | { success: false; httpStatus: number; errorKind: string; message: string }
  >;

  precheck?: X402Precheck<TBody>;

  idempotencyKey?: (body: TBody) => string | undefined;

  handler: X402Handler<TBody, TResult>;

  recoverReplayResult?: ReplayResultRecovery;

  rateLimitScope: string;

  rateLimitPerMinute: number;
}

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

type PreparedRequest =
  | { ok: true; network: NetworkConfig; recipientAddress: string; usdcPrice: number }
  | { ok: false; response: Response };

async function prepareRequest(params: {
  req: NextRequest;
  action: PurchasableX402Action;
  rateLimitScope: string;
  rateLimitPerMinute: number;
  context: RequestContext;
}): Promise<PreparedRequest> {
  const { context, action } = params;

  const [rateLimitResult, priceResult] = await Promise.all([
    checkRateLimit({
      operation: params.rateLimitScope,
      identifier: null,
      rule: { limit: params.rateLimitPerMinute, windowSeconds: RATE_LIMIT_WINDOW_SECONDS },
    }),
    readActionPrice(action),
  ]);
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

  if (!priceResult.ok) {
    console.error(`[prepareRequest] Pricing lookup failed for "${action}": ${priceResult.message}`);
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

async function buildChallengeResponse(params: {
  action: string;
  prepared: Extract<PreparedRequest, { ok: true }>;
  context: RequestContext;
}): Promise<Response> {
  const { action, prepared, context } = params;
  const paymentRequiredResult = await buildPaymentRequired({
    resourceUrl: `${getBaseUrl()}${context.endpointPath}`,
    network: prepared.network,
    amountUsdc: prepared.usdcPrice,
    recipientAddress: prepared.recipientAddress,
    error: "PAYMENT-SIGNATURE header is required",
  });
  if (!paymentRequiredResult.ok) {
    const isPricingInvalid = paymentRequiredResult.reason === "invalid_amount";
    return context.fail({
      principal: null,
      action,
      chargeId: null,
      resultStatus: "error",
      httpStatus: isPricingInvalid ? 500 : 502,
      errorKind: isPricingInvalid ? "pricing_not_configured" : "facilitator_error",
      message: paymentRequiredResult.message,
    });
  }
  context.audit({ principal: null, action, chargeId: null, resultStatus: "402_required" });
  return buildPaymentRequiredResponse(paymentRequiredResult.paymentRequired);
}

export function x402PaidEndpoint<TBody, TResult extends Json>(
  options: X402PaidEndpointOptions<TBody, TResult>,
): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest): Promise<Response> => {
    const requestId = randomUUID();
    const context = await createRequestContext(options.endpointPath);

    const paymentHeader = readPaymentHeader(req);
    const parsedRequest = await parsePaidRequest(req, options);

    if (!paymentHeader) {
      const challengeAction = parsedRequest.success ? parsedRequest.action : options.defaultAction;
      const challengePrepared = await prepareRequest({
        req,
        action: challengeAction,
        rateLimitScope: options.rateLimitScope,
        rateLimitPerMinute: options.rateLimitPerMinute,
        context,
      });
      if (!challengePrepared.ok) return challengePrepared.response;
      return buildChallengeResponse({ action: challengeAction, prepared: challengePrepared, context });
    }

    if (!parsedRequest.success) {
      return context.fail({
        principal: null,
        action: null,
        chargeId: null,
        resultStatus: "error",
        httpStatus: parsedRequest.httpStatus,
        errorKind: parsedRequest.errorKind,
        message: parsedRequest.message,
      });
    }
    const { body, action: actionKey } = parsedRequest;

    const prepared = await prepareRequest({
      req,
      action: actionKey,
      rateLimitScope: options.rateLimitScope,
      rateLimitPerMinute: options.rateLimitPerMinute,
      context,
    });
    if (!prepared.ok) return prepared.response;
    const { network, recipientAddress, usdcPrice } = prepared;

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

    const reservation = await reserveIdempotencyKey({
      endpointPath: options.endpointPath,
      principalId: principal.principalId,
      idempotencyKey: options.idempotencyKey?.(body),
      requestId,
    });
    if (reservation.kind === "held") {
      return context.fail({
        principal,
        action: actionKey,
        chargeId: null,
        resultStatus: "error",
        httpStatus: 409,
        errorKind: "idempotency_key_in_progress",
        message: `Another paid call with this idempotency_key is running, or ended less than ${KEY_RESERVATION_TTL_MS / 1000} seconds ago without a known payment outcome. No payment was taken.`,
        retryAfterSeconds: KEY_IN_PROGRESS_RETRY_AFTER_SECONDS,
      });
    }
    if (reservation.kind === "unavailable") {
      console.error(`[x402PaidEndpoint] Idempotency key reservation failed: ${reservation.message}`);
      return context.fail({
        principal,
        action: actionKey,
        chargeId: null,
        resultStatus: "error",
        httpStatus: 503,
        errorKind: "idempotency_check_unavailable",
        message: "The idempotency_key could not be checked. No payment was taken. Retry shortly.",
        retryAfterSeconds: KEY_CHECK_UNAVAILABLE_RETRY_AFTER_SECONDS,
      });
    }

    const paidCall = await chargeAndRunAction({
      req,
      options,
      body,
      actionKey,
      principal,
      paymentHeader,
      verified: verifyResult,
      prepared,
      requestId,
      context,
    });
    if (reservation.kind === "reserved" && !paidCall.mayHoldUnusedPayment) {
      await reservation.release();
    }
    return paidCall.response;
  };
}

type PaidCallOutcome = { response: Response; mayHoldUnusedPayment: boolean };

async function chargeAndRunAction<TBody, TResult extends Json>(params: {
  req: NextRequest;
  options: X402PaidEndpointOptions<TBody, TResult>;
  body: TBody;
  actionKey: PurchasableX402Action;
  principal: WalletPrincipal;
  paymentHeader: string;
  verified: VerifiedPayment;
  prepared: Extract<PreparedRequest, { ok: true }>;
  requestId: string;
  context: RequestContext;
}): Promise<PaidCallOutcome> {
  const { req, options, body, actionKey, principal, paymentHeader, verified, requestId, context } =
    params;
  const { network, recipientAddress, usdcPrice } = params.prepared;

  if (options.precheck) {
    const precheckResult = await options.precheck({ body, principal, network });
    if (!precheckResult.ok) {
      return {
        response: context.fail({
          principal,
          action: actionKey,
          chargeId: null,
          resultStatus: "error",
          httpStatus: precheckResult.httpStatus,
          errorKind: precheckResult.errorKind,
          message: `${precheckResult.message} No payment was taken.`,
        }),
        mayHoldUnusedPayment: false,
      };
    }
  }

  const chargeResult = await settleCharge({
    paymentHeader,
    network,
    verified,
    principal,
    action: actionKey,
    amountUsdc: usdcPrice,
    requestId,
    recipientAddress,
  });
  if (!chargeResult.ok) {
    switch (chargeResult.reason) {
      case "replay":
        return {
          response: await respondToReplay({
            replay: chargeResult.replay,
            req,
            options,
            body,
            principal,
            network,
            amountAtomic: verified.requirements.amount,
            payerAddress: verified.payerAddress,
            actionKey,
            requestId,
            context,
          }),
          mayHoldUnusedPayment: false,
        };
      case "charge_insert_failed":
        return {
          response: context.fail({
            principal,
            action: actionKey,
            chargeId: null,
            resultStatus: "error",
            httpStatus: 500,
            errorKind: "charge_insert_failed",
            message: `${chargeResult.message} No payment was taken.`,
          }),
          mayHoldUnusedPayment: false,
        };
      case "settle_failed":
        return {
          response: context.fail({
            principal,
            action: actionKey,
            chargeId: chargeResult.chargeId,
            resultStatus: "error",
            httpStatus: mapSettleErrorToHttpStatus(chargeResult.error.kind),
            errorKind: chargeResult.error.kind,
            message: chargeResult.error.message,
          }),
          mayHoldUnusedPayment: mayHaveSettled(chargeResult.error.kind),
        };
      case "settled_unrecorded":
        return {
          response: context.fail({
            principal,
            action: actionKey,
            chargeId: chargeResult.chargeId,
            resultStatus: "error",
            httpStatus: 500,
            errorKind: "charge_update_failed",
            message:
              "Payment settled but could not be recorded. It is queued for reconciliation; do not retry this payment.",
          }),
          mayHoldUnusedPayment: true,
        };
      default: {
        const unhandledResult: never = chargeResult;
        console.error(`[chargeAndRunAction] Unhandled charge result: ${JSON.stringify(unhandledResult)}`);
        return {
          response: context.fail({
            principal,
            action: actionKey,
            chargeId: null,
            resultStatus: "error",
            httpStatus: 500,
            errorKind: "internal_error",
            message: "Internal payment-state error.",
          }),
          mayHoldUnusedPayment: true,
        };
      }
    }
  }
  const { chargeId, txHash } = chargeResult;

  const handlerResult = await runHandler(options.handler, { body, principal, chargeId, requestId });

  if (!handlerResult.success) {
    const refundOutcome = await refundCharge({
      chargeId,
      settleTxHash: txHash,
      payerAddress: verified.payerAddress,
      amountUsdc: usdcPrice,
      network,
      reason: handlerResult.message,
      principalId: principal.principalId,
    });
    return {
      response: context.fail({
        principal,
        action: actionKey,
        chargeId,
        resultStatus: "error",
        httpStatus: 500,
        errorKind: handlerResult.errorKind,
        message: handlerResult.message,
        refundInitiated: refundOutcome.refundInitiated,
        refundTxHash: refundOutcome.refundTxHash,
      }),
      mayHoldUnusedPayment: !refundOutcome.refundConfirmed,
    };
  }

  const chargeRecord = handlerResult.chargeRecord ?? {};
  const storedMetadata = {
    ...(chargeRecord.metadata ?? {}),
    ...(req.method === "GET" ? {} : { result: handlerResult.data }),
  };
  const recordWrite = await updateChargeRecord(chargeId, {
    ...chargeRecord,
    metadata: Object.keys(storedMetadata).length > 0 ? storedMetadata : undefined,
  });
  if (!recordWrite.ok) {
    console.error(
      `[chargeAndRunAction] CHARGE RECORD INCOMPLETE: charge ${chargeId} succeeded but its result and post link were not saved after a retry (${recordWrite.message}); a replay of this payment answers only what the endpoint rebuilds from its own rows (409 when it rebuilds nothing) and /proof shows no post for it.`,
    );
  }

  context.audit({ principal, action: actionKey, chargeId, resultStatus: "ok" });
  return {
    response: buildSettledResponse({
      data: handlerResult.data,
      txHash,
      chargeId,
      network,
      payerAddress: verified.payerAddress,
      amountAtomic: verified.requirements.amount,
    }),
    mayHoldUnusedPayment: false,
  };
}

function mayHaveSettled(kind: SettlePaymentError["kind"]): boolean {
  switch (kind) {
    case "not_verified":
    case "insufficient_funds":
      return false;
    case "facilitator_error":
    case "timeout":
      return true;
    default: {
      const unhandledKind: never = kind;
      console.error(`[mayHaveSettled] Unhandled kind: ${String(unhandledKind)}`);
      return true;
    }
  }
}

export interface X402ChallengeGetOptions {
  endpointPath: string;

  action: PurchasableX402Action;

  rateLimitScope: string;

  rateLimitPerMinute: number;
}

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

async function parsePaidRequest<TBody, TResult>(
  req: NextRequest,
  options: X402PaidEndpointOptions<TBody, TResult>,
): Promise<
  | { success: true; body: TBody; action: PurchasableX402Action }
  | { success: false; httpStatus: number; errorKind: string; message: string }
> {
  const bodyResult = await options.parseBody(req);
  if (!bodyResult.success) return bodyResult;
  const actionResult = options.resolveAction(bodyResult.data);
  if (!actionResult.success) return actionResult;
  return { success: true, body: bodyResult.data, action: actionResult.action };
}

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
    };
  }
}

function buildSettledResponse(params: {
  data: Json;
  txHash: string;
  chargeId: string;
  network: NetworkConfig;
  payerAddress: string;
  amountAtomic: string;
}): Response {
  const settleResponse: SettleResponse = {
    success: true,
    payer: params.payerAddress,
    transaction: params.txHash,
    network: params.network.caipNetwork,
    amount: params.amountAtomic,
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

async function respondToReplay<TBody, TResult extends Json>(params: {
  replay: ChargeReplay;
  req: NextRequest;
  options: X402PaidEndpointOptions<TBody, TResult>;
  body: TBody;
  principal: WalletPrincipal;
  network: NetworkConfig;
  amountAtomic: string;
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
        retryAfterSeconds: REPLAY_RETRY_AFTER_SECONDS,
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
      if (replayData === null && params.options.recoverReplayResult) {
        const recovery = await params.options.recoverReplayResult({
          principal,
          chargeId: replay.chargeId,
          storedMetadata: replay.storedMetadata,
        });
        switch (recovery.kind) {
          case "recovered":
            replayData = recovery.data;
            break;
          case "not_found":
            break;
          case "lookup_failed":
            console.error(
              `[respondToReplay] Outcome lookup failed for replayed charge ${replay.chargeId}: ${recovery.message}`,
            );
            return context.fail({
              principal,
              action: actionKey,
              chargeId: replay.chargeId,
              resultStatus: "error",
              httpStatus: 503,
              errorKind: "replay_lookup_failed",
              message:
                "This payment was already used and its outcome could not be read right now. Retry the same request shortly; it is not charged again.",
              retryAfterSeconds: REPLAY_RETRY_AFTER_SECONDS,
            });
          default: {
            const unhandledRecovery: never = recovery;
            console.error(`[respondToReplay] Unhandled recovery: ${JSON.stringify(unhandledRecovery)}`);
          }
        }
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
        amountAtomic: params.amountAtomic,
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

function describeVerifyError(error: VerifyPaymentError): string {
  switch (error.kind) {
    case "malformed_header":
    case "invalid_signature":
    case "invalid_payment":
    case "insufficient_funds":
    case "authorization_expired":
    case "facilitator_error":
    case "invalid_amount":
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
    case "invalid_amount":
      return 500;
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
