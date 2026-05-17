import "server-only";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

import { encodePaymentResponseHeader } from "@x402/core/http";
import type { SettleResponse } from "@x402/core/types";

import { extractIpHash, extractUserAgent } from "@/lib/api/context";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { adminSupabase } from "@/actions/api/adminSupabase";

import { verifyPayment, settlePayment, refundPayment } from "@/lib/x402/facilitator";
import type { NetworkConfig } from "@/lib/x402/networks";
import { getNetworkConfig, getDefaultNetwork } from "@/lib/x402/networks";
import { resolveWalletPrincipal } from "@/lib/x402/auth/resolveWalletPrincipal";
import type { WalletPrincipal } from "@/lib/x402/auth/types";
import { applyWalletGate } from "@/lib/x402/sanctions/applyWalletGate";
import { logX402Call } from "@/lib/x402/audit/logX402Call";

import { insertX402Charge } from "@/lib/x402/charges/insertX402Charge";
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
 * Business logic called AFTER payment is settled and charge row is inserted.
 * Returns the response body on success, or a typed error for the refund path.
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
 * Higher-order function wrapping the common x402 verify/settle/log/refund flow.
 *
 * Steps:
 * 1. Parse body via options.parseBody.
 * 2. Resolve action key + lookup pricing from pricing_actions table.
 * 3. Rate limit per IP.
 * 4. If no X-PAYMENT header: return 402 with pricing info.
 * 5. Resolve network from ?network query param.
 * 6. Verify payment via facilitator (off-chain).
 * 7. Resolve wallet principal from payer address.
 * 8. Apply sanctions gate.
 * 9. Settle payment on-chain.
 * 10. Insert x402_charges with status="settled" (single INSERT, all metadata).
 * 11. If insert fails: refund, insert x402_refunds, return 500.
 * 12. Execute business logic handler.
 * 13. If handler returns refundable failure: refund + x402_refunds + charge→"refunded".
 * 14. If handler returns non-refundable failure: charge→"failed" (non-fatal update).
 * 15. Return success with X-PAYMENT-RESPONSE header.
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

    // ── Step 2: Resolve action + lookup pricing ──────────────────────────
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

    const { data: pricingRow, error: pricingError } = await adminSupabase
      .from("pricing_actions")
      .select("usdc_price")
      .eq("action", actionKey)
      .or("effective_until.is.null,effective_until.gt." + new Date().toISOString())
      .limit(1)
      .single();

    if (pricingError || !pricingRow) {
      console.error(`[x402PaidEndpoint] pricing_actions lookup failed for "${actionKey}":`, pricingError);
      return logAndError({
        principal: null,
        action: actionKey,
        chargeId: null,
        resultStatus: "error",
        httpStatus: 500,
        errorKind: "pricing_not_configured",
        message: `No active pricing found for action "${actionKey}".`,
      });
    }
    const usdcPrice = pricingRow.usdc_price;

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

    // ── Step 4: Check X-PAYMENT header ───────────────────────────────────
    const paymentHeader = req.headers.get("x-payment");
    if (!paymentHeader) {
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
      return NextResponse.json(
        {
          status: 402,
          action: actionKey,
          usdcPrice,
          message: "Payment required. Include X-PAYMENT header with signed payment.",
          x402Version: 2,
        },
        { status: 402 }
      );
    }

    // ── Step 5: Resolve network ──────────────────────────────────────────
    const url = new URL(req.url);
    const networkParam = url.searchParams.get("network");
    const network: NetworkConfig = networkParam
      ? getNetworkConfig(networkParam) ?? getDefaultNetwork()
      : getDefaultNetwork();

    const recipientAddress = network.isEvm
      ? process.env.X402_RECIPIENT_EVM
      : process.env.X402_RECIPIENT_SOLANA;
    if (!recipientAddress) {
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

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://sharetopus.com";
    const resourceUrl = `${baseUrl}${options.endpointPath}`;

    // ── Step 6: Verify payment (off-chain) ───────────────────────────────
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

    // ── Step 7: Resolve wallet principal ─────────────────────────────────
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

    // ── Step 8: Sanctions gate ───────────────────────────────────────────
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

    // ── Step 9: Settle payment (on-chain) ────────────────────────────────
    const settleResult = await settlePayment({ paymentHeader, network });
    if (!settleResult.ok) {
      const settleError = settleResult.error;
      return logAndError({
        principal,
        action: actionKey,
        chargeId: null,
        resultStatus: "error",
        httpStatus: mapSettleErrorToHttpStatus(settleError.kind),
        errorKind: settleError.kind,
        message: settleError.message,
      });
    }

    // ── Step 10: Insert charge (status="settled", single INSERT) ─────────
    const chargeResult = await insertX402Charge({
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
      txHash: settleResult.txHash,
      blockNumber: settleResult.blockNumber,
      facilitatorFeeUsdc: settleResult.facilitatorFeeUsdc,
    });

    // ── Step 11: If insert fails, refund ─────────────────────────────────
    if (!chargeResult.success) {
      const refundResult = await refundPayment({
        originalTxHash: settleResult.txHash,
        payerAddress: verifyResult.payerAddress,
        amountUsdc: usdcPrice,
        network,
        reason: `Charge insert failed: ${chargeResult.message}`,
      });

      // Note: cannot insert x402_refunds row because charge_id FK is required
      // and no charge row exists. The refund is recorded in the audit log and
      // the on-chain tx_hash is returned in the error response for reconciliation.

      return logAndError({
        principal,
        action: actionKey,
        chargeId: null,
        resultStatus: "error",
        httpStatus: 500,
        errorKind: "charge_insert_failed",
        message: chargeResult.message,
        refundInitiated: true,
        refundTxHash: refundResult.ok ? refundResult.refundTxHash : null,
      });
    }
    const chargeId = chargeResult.chargeId;

    // ── Step 12: Execute business logic handler ──────────────────────────
    const handlerResult = await options.handler({
      body,
      principal,
      chargeId,
      requestId,
    });

    // ── Steps 13-15: Handle result ────────────────────────────────────
    if (!handlerResult.success) {
      if (handlerResult.refundable) {
        // Step 13: Refundable failure. Issue on-chain refund.
        const refundResult = await refundPayment({
          originalTxHash: settleResult.txHash,
          payerAddress: verifyResult.payerAddress,
          amountUsdc: usdcPrice,
          network,
          reason: handlerResult.message,
        });

        // Update charge status to "refunded".
        await adminSupabase
          .from("x402_charges")
          .update({ status: "refunded", error_message: handlerResult.message })
          .eq("id", chargeId);

        // Insert x402_refunds row.
        await adminSupabase.from("x402_refunds").insert({
          charge_id: chargeId,
          reason: handlerResult.message,
          refunded_usdc: usdcPrice,
          refund_tx_hash: refundResult.ok ? refundResult.refundTxHash : null,
          initiated_by: principal.principalId,
        });

        return logAndError({
          principal,
          action: actionKey,
          chargeId,
          resultStatus: "error",
          httpStatus: 500,
          errorKind: handlerResult.errorKind,
          message: handlerResult.message,
          refundInitiated: true,
          refundTxHash: refundResult.ok ? refundResult.refundTxHash : null,
        });
      }

      // Step 14: Non-refundable failure. Non-fatal status update.
      await adminSupabase
        .from("x402_charges")
        .update({ status: "failed", error_message: handlerResult.message })
        .eq("id", chargeId);

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
    const atomicAmount = String(
      Math.round(usdcPrice * 10 ** network.usdcDecimals)
    );
    const settleResponse: SettleResponse = {
      success: true,
      payer: verifyResult.payerAddress,
      transaction: settleResult.txHash,
      network: network.caipNetwork as `${string}:${string}`,
      amount: atomicAmount,
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
