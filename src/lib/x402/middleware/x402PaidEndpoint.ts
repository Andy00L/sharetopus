import "server-only";

import { NextResponse } from "next/server";
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
import { resolveWalletPrincipal } from "@/lib/x402/auth/resolveWalletPrincipal";
import type { WalletPrincipal } from "@/lib/x402/auth/types";
import { applyWalletGate } from "@/lib/x402/sanctions/applyWalletGate";
import { logX402Call } from "@/lib/x402/audit/logX402Call";

import { insertPendingX402Charge } from "@/lib/x402/charges/insertPendingX402Charge";
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
 * flow shared by every paid endpoint except register and connect (those two
 * create rows atomically via Postgres RPCs and live in register/ and
 * connect/).
 *
 * Steps:
 *  1. Parse body via options.parseBody.
 *  2. Resolve action key.
 *  3. Rate limit per IP.
 *  4. Resolve network from ?network (unknown values are rejected, per the
 *     registry contract in networks.ts) and the recipient address.
 *  5. Read the currently effective price.
 *  6. If no payment header: 402 with the v2 PaymentRequired header + body.
 *  7. Verify payment via facilitator (off-chain, includes KYT).
 *  8. Resolve wallet principal from the facilitator-recovered payer; apply
 *     the sanctions gate.
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

    // ── Step 1: Parse body ───────────────────────────────────────────────
    const bodyResult = await options.parseBody(req);
    if (!bodyResult.success) {
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
    const body = bodyResult.data;

    // ── Step 2: Resolve action ───────────────────────────────────────────
    const actionResult = options.resolveAction(body);
    if (!actionResult.success) {
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
    const actionKey = actionResult.action;

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

    // ── Step 6: Check payment header; 402 with requirements if absent ────
    const paymentHeader = readPaymentHeader(req);
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

    // ── Step 8: Resolve wallet principal + sanctions gate ────────────────
    const walletResult = await resolveWalletPrincipal(verifyResult.payerAddress);
    if (!walletResult.ok) {
      return logAndError({
        principal: null,
        action: actionKey,
        chargeId: null,
        resultStatus: "error",
        httpStatus: 402,
        errorKind: "wallet_not_registered",
        message: "Wallet not registered. Call POST /api/x402/register first.",
      });
    }
    const principal = walletResult.principal;

    const gateResult = await applyWalletGate(principal.walletId);
    if (!gateResult.allowed) {
      return logAndError({
        principal,
        action: actionKey,
        chargeId: null,
        resultStatus: "sanctioned",
        httpStatus: 403,
        errorKind: "sanctioned",
        message: `Wallet access denied: ${gateResult.reason}.`,
      });
    }

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
