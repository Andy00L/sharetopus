import "server-only";

import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

import { encodePaymentResponseHeader } from "@x402/core/http";
import type { SettleResponse } from "@x402/core/types";

import { extractIpHash, extractUserAgent } from "@/lib/api/context";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";

import { verifyPayment, settlePayment, refundPayment } from "@/lib/x402/facilitator";
import type { NetworkConfig } from "@/lib/x402/networks";
import { getNetworkConfig, getDefaultNetwork } from "@/lib/x402/networks";
import { getBaseUrl, getRecipientAddress } from "@/lib/x402/config";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";
import {
  readPaymentHeader,
  buildPaymentRequired,
} from "@/lib/x402/http/paymentHttp";
import { readActionPrice } from "@/lib/x402/pricing/readActionPrice";
import { resolveOrOnboardWalletPrincipal } from "@/lib/x402/auth/resolveOrOnboardWalletPrincipal";
import type { WalletPrincipal } from "@/lib/x402/auth/types";
import { logX402Call } from "@/lib/x402/audit/logX402Call";

import { insertPendingX402Charge } from "@/lib/x402/charges/insertPendingX402Charge";
import { recordX402Reconciliation } from "@/lib/x402/charges/recordReconciliation";
import {
  markChargeSettled,
  markChargeFailed,
  markChargeRefunded,
} from "@/lib/x402/charges/chargeTransitions";
import { buildPaymentRequiredResponse } from "@/lib/x402/responses/buildPaymentRequiredResponse";
import { buildGenericSuccessResponse } from "@/lib/x402/responses/buildSuccessResponse";
import { buildGenericErrorResponse } from "@/lib/x402/responses/buildErrorResponse";

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
 * Business logic called AFTER payment is settled and the charge row reached
 * status="settled". Returns the response body on success, or a typed error
 * for the refund path.
 */
export type X402Handler<TBody, TResult> = (params: {
  body: TBody;
  principal: WalletPrincipal;
  chargeId: string;
  requestId: string;
}) => Promise<
  | { success: true; data: TResult }
  | { success: false; errorKind: string; message: string; refundable: boolean }
>;

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

  /** Business logic handler called after payment is settled. */
  handler: X402Handler<TBody, TResult>;

  /** Rate limit scope identifier (e.g. "x402:post-now"). */
  rateLimitScope: string;

  /** Max requests per minute per IP for this endpoint. */
  rateLimitPerMinute: number;
}

// ---------------------------------------------------------------------------
// HOF: x402PaidEndpoint
// ---------------------------------------------------------------------------

/**
 * Higher-order function wrapping the common x402 verify/settle/log/refund
 * flow shared by every paid endpoint except connect (it creates its rows
 * atomically via a Postgres RPC and lives in connect/).
 *
 * Steps:
 *  1. Read the payment header (payment-first: unpaid requests are answered
 *     with a 402 challenge even when their body is invalid; see
 *     options.defaultAction).
 *  2. Parse body and resolve the action key. Invalid body or action with a
 *     payment header present: 400 before any verify/settle. Without one:
 *     fall back to defaultAction for challenge pricing.
 *  3. Rate limit per IP.
 *  4. Resolve network from ?network (unknown values are rejected, per the
 *     registry contract in networks.ts) and the recipient address.
 *  5. Read the currently effective price.
 *  6. If no payment header: 402 with the v2 PaymentRequired header + body.
 *  7. Verify payment via facilitator (off-chain, includes KYT).
 *  8. Resolve or onboard the wallet principal from the facilitator-recovered
 *     payer. A wallet's first verified payment IS its onboarding (verify
 *     already screened the payer); sanctioned wallets are rejected here,
 *     before any charge row or settlement.
 *  9. Insert x402_charges with status="pending". This runs BEFORE settle so
 *     a crash never leaves settled money without a record, and so a replayed
 *     payment loses the nonce-unique race before any second settle.
 * 10. Settle payment on-chain; failure marks the charge "failed".
 * 11. Transition the charge pending -> settled (status-scoped).
 * 12. Execute the business logic handler.
 * 13. Refundable handler failure: on-chain refund; only a SUCCESSFUL refund
 *     is recorded as refunded + x402_refunds, a failed refund marks the
 *     charge failed with a refund_failed message for reconciliation.
 * 14. Non-refundable handler failure: charge -> "failed".
 * 15. Success response with PAYMENT-RESPONSE (and v1 X-PAYMENT-RESPONSE).
 */
export function x402PaidEndpoint<TBody, TResult>(
  options: X402PaidEndpointOptions<TBody, TResult>,
): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest): Promise<Response> => {
    const startMs = performance.now();
    const requestId = randomUUID();
    const ipHash = await extractIpHash();
    const userAgent = await extractUserAgent();

    // Helper: compute latency for audit logging.
    const latencyMs = () => Math.round(performance.now() - startMs);

    // Helper: log audit entry and return an error response.
    const logAndError = async (params: {
      principal: WalletPrincipal | null;
      action: string | null;
      chargeId: string | null;
      resultStatus: "error" | "402_required" | "sanctioned" | "rate_limited";
      httpStatus: number;
      errorKind: string;
      message: string;
      retryAfterSeconds?: number;
      refundInitiated?: boolean;
      refundTxHash?: string | null;
    }): Promise<Response> => {
      await logX402Call({
        principal: params.principal,
        action: params.action,
        endpoint: options.endpointPath,
        chargeId: params.chargeId,
        resultStatus: params.resultStatus,
        latencyMs: latencyMs(),
        ipHash,
        userAgent,
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

    // ── Step 1: Read the payment header ──────────────────────────────────
    // Read before body validation: x402 is payment-first, so an unpaid
    // request must get the 402 challenge even when its body is invalid or
    // empty (marketplace validators probe exactly that way).
    const paymentHeader = readPaymentHeader(req);

    // ── Step 2: Parse body and resolve action ────────────────────────────
    // Paid requests keep strict validation (400 before any verify/settle).
    // Unpaid requests fall back to options.defaultAction for challenge
    // pricing; the null parsedBody never survives past the 402 return.
    let parsedBody: { data: TBody } | null = null;
    let actionKey: string = options.defaultAction;
    const bodyResult = await options.parseBody(req);
    if (bodyResult.success) {
      const actionResult = options.resolveAction(bodyResult.data);
      if (actionResult.success) {
        parsedBody = { data: bodyResult.data };
        actionKey = actionResult.action;
      } else if (paymentHeader) {
        return logAndError({
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
      return logAndError({
        principal: null,
        action: null,
        chargeId: null,
        resultStatus: "error",
        httpStatus: bodyResult.httpStatus,
        errorKind: bodyResult.errorKind,
        message: bodyResult.message,
      });
    }

    // ── Step 3: Rate limit per IP ────────────────────────────────────────
    const rateLimitResult = await checkRateLimit(
      options.rateLimitScope,
      null,
      options.rateLimitPerMinute,
      60
    );
    if (!rateLimitResult.success) {
      return logAndError({
        principal: null,
        action: actionKey,
        chargeId: null,
        resultStatus: "rate_limited",
        httpStatus: 429,
        errorKind: "rate_limited",
        message: rateLimitResult.message ?? "Rate limit exceeded.",
        retryAfterSeconds: rateLimitResult.resetIn ?? 60,
      });
    }

    // ── Step 4: Resolve network + recipient ──────────────────────────────
    const url = new URL(req.url);
    const networkParam = url.searchParams.get("network");
    let network: NetworkConfig;
    if (networkParam) {
      const requestedNetwork = getNetworkConfig(networkParam);
      if (!requestedNetwork) {
        return logAndError({
          principal: null,
          action: actionKey,
          chargeId: null,
          resultStatus: "error",
          httpStatus: 400,
          errorKind: "unsupported_network",
          message: `Network "${networkParam}" is not supported.`,
        });
      }
      network = requestedNetwork;
    } else {
      network = getDefaultNetwork();
    }

    const recipientAddress = getRecipientAddress(network);
    if (!recipientAddress) {
      console.error(`[x402PaidEndpoint] Recipient address env not set for network "${network.name}".`);
      return logAndError({
        principal: null,
        action: actionKey,
        chargeId: null,
        resultStatus: "error",
        httpStatus: 500,
        errorKind: "server_misconfiguration",
        message: "Recipient address not configured for this network.",
      });
    }

    const resourceUrl = `${getBaseUrl()}${options.endpointPath}`;

    // ── Step 5: Read the currently effective price ───────────────────────
    const priceResult = await readActionPrice(actionKey);
    if (!priceResult.ok) {
      console.error(`[x402PaidEndpoint] Pricing lookup failed for "${actionKey}": ${priceResult.message}`);
      // action: null here because the action row may not exist at all, and
      // x402_access_log.action carries an FK to pricing_actions.
      return logAndError({
        principal: null,
        action: null,
        chargeId: null,
        resultStatus: "error",
        httpStatus: 500,
        errorKind: "pricing_not_configured",
        message: priceResult.message,
      });
    }
    const usdcPrice = priceResult.usdcPrice;

    // ── Step 6: No payment header: 402 with requirements ─────────────────
    if (!paymentHeader) {
      // A Solana 402 without extra.feePayer is unpayable by spec-compliant
      // clients, so a fee-payer outage returns 502 instead of an empty 402.
      // EVM networks never hit the failure branch (no fee payer involved).
      const paymentRequiredResult = await buildPaymentRequired({
        resourceUrl,
        network,
        amountUsdc: usdcPrice,
        recipientAddress,
        error: "PAYMENT-SIGNATURE header is required",
      });
      if (!paymentRequiredResult.ok) {
        return logAndError({
          principal: null,
          action: actionKey,
          chargeId: null,
          resultStatus: "error",
          httpStatus: 502,
          errorKind: "facilitator_error",
          message: paymentRequiredResult.message,
        });
      }
      await logX402Call({
        principal: null,
        action: actionKey,
        endpoint: options.endpointPath,
        chargeId: null,
        resultStatus: "402_required",
        latencyMs: latencyMs(),
        ipHash,
        userAgent,
      });
      return buildPaymentRequiredResponse(paymentRequiredResult.paymentRequired);
    }

    // A null parsedBody only exists on the unpaid path, which returned the
    // 402 above; this guard is a fail-closed invariant check, not control
    // flow. Distinct message so it is findable if the invariant ever breaks.
    if (parsedBody === null) {
      console.error("[x402PaidEndpoint] Invariant violation: paid path reached without a parsed body.");
      return logAndError({
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

    // ── Step 7: Verify payment (off-chain) ───────────────────────────────
    const verifyResult = await verifyPayment({
      paymentHeader,
      resourceUrl,
      amountUsdc: usdcPrice,
      recipientAddress,
      network,
    });

    if (!verifyResult.ok) {
      const verifyError = verifyResult.error;
      const isSanctioned = verifyError.kind === "kyt_sanctioned";
      return logAndError({
        principal: null,
        action: actionKey,
        chargeId: null,
        resultStatus: isSanctioned ? "sanctioned" : "error",
        httpStatus: mapVerifyErrorToHttpStatus(verifyError.kind),
        errorKind: verifyError.kind,
        message: "message" in verifyError ? verifyError.message : "Payment verification failed.",
      });
    }

    // ── Step 8: Resolve or onboard the wallet principal ──────────────────
    // verifyPayment above already screened this payer (facilitator KYT), so
    // a first-time wallet is onboarded here, strictly before the pending
    // charge insert and settlement. Sanctioned wallets are rejected with no
    // USDC moved.
    const walletResult = await resolveOrOnboardWalletPrincipal({
      payerAddress: verifyResult.payerAddress,
      network,
    });
    if (!walletResult.ok) {
      if (walletResult.reason === "sanctioned") {
        // The denied wallet's identity is known; attribute the audit row.
        return logAndError({
          principal: walletResult.principal,
          action: actionKey,
          chargeId: null,
          resultStatus: "sanctioned",
          httpStatus: 403,
          errorKind: "sanctioned",
          message: walletResult.message,
        });
      }
      return logAndError({
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

    // ── Step 9: Insert pending charge (replay backstop, pre-settle) ──────
    const chargeResult = await insertPendingX402Charge({
      principalId: principal.principalId,
      walletId: principal.walletId,
      action: actionKey,
      amountUsdc: usdcPrice,
      amountUsdAtReceipt: null,
      network: network.name,
      nonce: verifyResult.nonce,
      requestId,
      payerAddress: verifyResult.payerAddress,
      recipientAddress,
    });

    if (!chargeResult.success) {
      // No settle has happened yet, so a failed insert costs nothing and
      // needs no refund. A nonce conflict means this exact payment was
      // already presented: replay.
      const isReplay = chargeResult.conflictReason === "nonce_used";
      return logAndError({
        principal,
        action: actionKey,
        chargeId: null,
        resultStatus: "error",
        httpStatus: isReplay ? 409 : 500,
        errorKind: isReplay ? "replay_detected" : "charge_insert_failed",
        message: chargeResult.message,
      });
    }
    const chargeId = chargeResult.chargeId;

    // ── Step 10: Settle payment (on-chain) ───────────────────────────────
    const settleResult = await settlePayment({ paymentHeader, network });
    if (!settleResult.ok) {
      const settleError = settleResult.error;
      // Only a definitive facilitator rejection proves no money moved. A
      // timeout or transport-level failure is outcome-indeterminate: the
      // settlement may still land on-chain, so the charge stays "pending"
      // as the reconciliation marker instead of asserting "failed".
      const settleOutcomeIsDefinitive =
        settleError.kind === "not_verified" ||
        settleError.kind === "insufficient_funds";
      if (settleOutcomeIsDefinitive) {
        await markChargeFailed({
          chargeId,
          fromStatus: "pending",
          errorMessage: `settle_failed: ${settleError.message}`,
        });
      } else {
        console.error(
          `[x402PaidEndpoint] CHARGE RECONCILIATION NEEDED: charge ${chargeId} settle outcome indeterminate (${settleError.kind}): ${settleError.message}`
        );
        await recordX402Reconciliation({
          kind: "settle_indeterminate",
          chargeId,
          network: network.name,
          payerAddress: verifyResult.payerAddress,
        });
      }
      return logAndError({
        principal,
        action: actionKey,
        chargeId,
        resultStatus: "error",
        httpStatus: mapSettleErrorToHttpStatus(settleError.kind),
        errorKind: settleError.kind,
        message: settleError.message,
      });
    }

    // ── Step 11: pending -> settled ──────────────────────────────────────
    const settledTransition = await markChargeSettled({
      chargeId,
      txHash: settleResult.txHash,
      blockNumber: settleResult.blockNumber,
      facilitatorFeeUsdc: settleResult.facilitatorFeeUsdc,
      settledAt: settleResult.settledAt,
    });
    if (!settledTransition.success) {
      // Money moved on-chain but the row could not transition. The pending
      // row plus this log line (with the tx hash) is the reconciliation
      // trail; auto-refunding against an uncertain DB state risks paying
      // twice, so this fails closed for manual review instead.
      console.error(
        `[x402PaidEndpoint] CHARGE RECONCILIATION NEEDED: charge ${chargeId} settled on-chain (tx ${settleResult.txHash}) but could not transition to settled: ${settledTransition.message}`
      );
      await recordX402Reconciliation({
        kind: "settle_unrecorded",
        chargeId,
        txHash: settleResult.txHash,
        network: network.name,
        payerAddress: verifyResult.payerAddress,
      });
      return logAndError({
        principal,
        action: actionKey,
        chargeId,
        resultStatus: "error",
        httpStatus: 500,
        errorKind: "charge_update_failed",
        message: "Payment settled but could not be recorded. Support has been notified; do not retry this payment.",
      });
    }

    // ── Step 12: Execute business logic handler ──────────────────────────
    // Handlers return errors as values, but money has already settled by
    // this point, so an unexpected throw must not escape the middleware: it
    // is converted into a refundable failure and goes through step 13.
    let handlerResult: Awaited<ReturnType<typeof options.handler>>;
    try {
      handlerResult = await options.handler({
        body,
        principal,
        chargeId,
        requestId,
      });
    } catch (err) {
      console.error(`[x402PaidEndpoint] Handler threw for charge ${chargeId}:`, err instanceof Error ? err.message : err);
      handlerResult = {
        success: false,
        errorKind: "internal_error",
        message: "Unexpected error while executing the paid action.",
        refundable: true,
      };
    }

    // ── Steps 13-14: Handle handler failure ──────────────────────────────
    if (!handlerResult.success) {
      if (handlerResult.refundable) {
        // Step 13: Refundable failure. Issue the on-chain refund first; the
        // DB only says "refunded" when the refund actually happened.
        const refundResult = await refundPayment({
          originalTxHash: settleResult.txHash,
          payerAddress: verifyResult.payerAddress,
          amountUsdc: usdcPrice,
          network,
          reason: handlerResult.message,
        });

        if (refundResult.ok) {
          const refundedTransition = await markChargeRefunded({
            chargeId,
            reason: handlerResult.message,
            refundedUsdc: usdcPrice,
            refundTxHash: refundResult.refundTxHash,
            initiatedBy: principal.principalId,
          });
          if (!refundedTransition.success) {
            // The refund happened on-chain but the row still says settled;
            // this log line carries the tx hash for reconciliation.
            console.error(
              `[x402PaidEndpoint] CHARGE RECONCILIATION NEEDED: charge ${chargeId} refunded on-chain (refund tx ${refundResult.refundTxHash}) but could not be recorded: ${refundedTransition.message}`
            );
          }
        } else {
          console.error(
            `[x402PaidEndpoint] REFUND FAILED for charge ${chargeId} (settle tx ${settleResult.txHash}): ${refundResult.error.message}`
          );
          await recordX402Reconciliation({
            kind: "refund_failed",
            chargeId,
            txHash: settleResult.txHash,
            network: network.name,
            payerAddress: verifyResult.payerAddress,
          });
          await markChargeFailed({
            chargeId,
            fromStatus: "settled",
            errorMessage: `refund_failed: ${handlerResult.message}`,
          });
        }

        return logAndError({
          principal,
          action: actionKey,
          chargeId,
          resultStatus: "error",
          httpStatus: 500,
          errorKind: handlerResult.errorKind,
          message: handlerResult.message,
          refundInitiated: refundResult.ok,
          refundTxHash: refundResult.ok ? refundResult.refundTxHash : null,
        });
      }

      // Step 14: Non-refundable failure.
      await markChargeFailed({
        chargeId,
        fromStatus: "settled",
        errorMessage: handlerResult.message,
      });

      return logAndError({
        principal,
        action: actionKey,
        chargeId,
        resultStatus: "error",
        httpStatus: 500,
        errorKind: handlerResult.errorKind,
        message: handlerResult.message,
      });
    }

    // ── Step 15: Success ─────────────────────────────────────────────────
    const settleResponse: SettleResponse = {
      success: true,
      payer: verifyResult.payerAddress,
      transaction: settleResult.txHash,
      network: network.caipNetwork as `${string}:${string}`,
      amount: usdcToAtomic(usdcPrice, network.usdcDecimals),
    };
    const paymentResponseHeader = encodePaymentResponseHeader(settleResponse);

    await logX402Call({
      principal,
      action: actionKey,
      endpoint: options.endpointPath,
      chargeId,
      resultStatus: "ok",
      latencyMs: latencyMs(),
      ipHash,
      userAgent,
    });

    return buildGenericSuccessResponse({
      data: handlerResult.data,
      txHash: settleResult.txHash,
      network: network.name,
      payerAddress: verifyResult.payerAddress,
      chargeId,
      paymentResponseHeader,
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
    const startMs = performance.now();
    const ipHash = await extractIpHash();
    const userAgent = await extractUserAgent();
    const latencyMs = () => Math.round(performance.now() - startMs);

    const logChallengeCall = async (
      resultStatus: "402_required" | "rate_limited" | "error",
      action: string | null,
    ): Promise<void> => {
      await logX402Call({
        principal: null,
        action,
        endpoint: options.endpointPath,
        chargeId: null,
        resultStatus,
        latencyMs: latencyMs(),
        ipHash,
        userAgent,
      });
    };

    const rateLimitResult = await checkRateLimit(
      options.rateLimitScope,
      null,
      options.rateLimitPerMinute,
      60
    );
    if (!rateLimitResult.success) {
      await logChallengeCall("rate_limited", options.action);
      return buildGenericErrorResponse({
        httpStatus: 429,
        errorKind: "rate_limited",
        message: rateLimitResult.message ?? "Rate limit exceeded.",
        retryAfterSeconds: rateLimitResult.resetIn ?? 60,
        chargeId: null,
      });
    }

    const url = new URL(req.url);
    const networkParam = url.searchParams.get("network");
    let network: NetworkConfig;
    if (networkParam) {
      const requestedNetwork = getNetworkConfig(networkParam);
      if (!requestedNetwork) {
        await logChallengeCall("error", options.action);
        return buildGenericErrorResponse({
          httpStatus: 400,
          errorKind: "unsupported_network",
          message: `Network "${networkParam}" is not supported.`,
          chargeId: null,
        });
      }
      network = requestedNetwork;
    } else {
      network = getDefaultNetwork();
    }

    const recipientAddress = getRecipientAddress(network);
    if (!recipientAddress) {
      console.error(`[x402ChallengeGet] Recipient address env not set for network "${network.name}".`);
      await logChallengeCall("error", options.action);
      return buildGenericErrorResponse({
        httpStatus: 500,
        errorKind: "server_misconfiguration",
        message: "Recipient address not configured for this network.",
        chargeId: null,
      });
    }

    const priceResult = await readActionPrice(options.action);
    if (!priceResult.ok) {
      console.error(`[x402ChallengeGet] Pricing lookup failed for "${options.action}": ${priceResult.message}`);
      // action: null because x402_access_log.action carries an FK to
      // pricing_actions and the row may not exist.
      await logChallengeCall("error", null);
      return buildGenericErrorResponse({
        httpStatus: 500,
        errorKind: "pricing_not_configured",
        message: priceResult.message,
        chargeId: null,
      });
    }

    const paymentRequiredResult = await buildPaymentRequired({
      resourceUrl: `${getBaseUrl()}${options.endpointPath}`,
      network,
      amountUsdc: priceResult.usdcPrice,
      recipientAddress,
      error: "PAYMENT-SIGNATURE header is required",
    });
    if (!paymentRequiredResult.ok) {
      await logChallengeCall("error", options.action);
      return buildGenericErrorResponse({
        httpStatus: 502,
        errorKind: "facilitator_error",
        message: paymentRequiredResult.message,
        chargeId: null,
      });
    }

    await logChallengeCall("402_required", options.action);
    return buildPaymentRequiredResponse(paymentRequiredResult.paymentRequired);
  };
}

// ---------------------------------------------------------------------------
// Error-to-HTTP-status mappers
// ---------------------------------------------------------------------------

function mapVerifyErrorToHttpStatus(kind: string): number {
  switch (kind) {
    case "malformed_header":
    case "invalid_signature":
      return 400;
    case "amount_mismatch":
    case "network_mismatch":
    case "recipient_mismatch":
      return 402;
    case "replay_detected":
      return 409;
    case "kyt_sanctioned":
      return 403;
    case "facilitator_error":
      return 502;
    default:
      return 400;
  }
}

function mapSettleErrorToHttpStatus(kind: string): number {
  switch (kind) {
    case "not_verified":
      return 500;
    case "insufficient_funds":
      return 402;
    case "facilitator_error":
      return 502;
    case "timeout":
      return 504;
    default:
      return 500;
  }
}
