import "server-only";

/**
 * Wrapper around the x402 facilitators (CDP for base, polygon, arbitrum and
 * solana; the Celo facilitator for celo; the in-process one for arc). Three
 * operations: verify a payment header, settle a verified payment, and
 * refund a settled payment. Each returns an errors-as-values result.
 *
 * Called by: charges/chargeLifecycle.ts, connect/handleConnectVerify.ts,
 *            the paid middleware (verify)
 * Tables touched: none (the facilitator is external; DB writes happen in the
 * charge lifecycle)
 *
 * SDK notes (verified against @x402/core v2.14.0):
 *   - Network is CAIP format ("eip155:8453") in the SDK, not WalletChain
 *     ("base"). NetworkConfig.caipNetwork bridges the two (networks.ts).
 *   - VerifyResponse is { isValid, invalidReason?, invalidMessage?, payer? }
 *     and SettleResponse is { success, transaction, network, errorReason?, ... }.
 *     Reason codes are matched exactly against the codes @x402/evm defines
 *     (v2.14.0 exact facilitator); see classifyVerifyReason and
 *     classifySettleReason.
 *   - Facilitator auth (CDP JWTs, Celo X-API-Key) is wired per lane in
 *     facilitatorClient.ts.
 *   - Refunds never go through a facilitator (it only handles agent to
 *     merchant); refundPayment dispatches on the lane and confirms on-chain.
 */

import { decodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

import { refundArc } from "@/lib/x402/arc/refundArc";
import { refundCdpEvm } from "@/lib/x402/cdp/refundCdpEvm";
import { refundCelo } from "@/lib/x402/celo/refundCelo";
import { confirmTransaction } from "@/lib/x402/chain/confirmTransaction";
import type { RefundSendInput, RefundSendResult } from "@/lib/x402/chain/refundSender";
import { getFacilitatorClient } from "@/lib/x402/facilitatorClient";
import { buildPaymentRequirements } from "@/lib/x402/http/paymentHttp";
import { addressesMatch, type NetworkConfig } from "@/lib/x402/networks";
import {
  extractNonceFromPayload,
  fallbackNonceFromHeader,
} from "@/lib/x402/payment/paymentPayload";
import { refundSolana } from "@/lib/x402/solana/refundSolana";

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export interface VerifyPaymentInput {
  /** Raw payment header value (PAYMENT-SIGNATURE, or X-PAYMENT from v1 clients). */
  paymentHeader: string;

  /** Expected payment amount in USDC units (human, not atomic). */
  amountUsdc: number;

  /** Recipient (payTo) address on this network. */
  recipientAddress: string;

  /** Network the agent claims to be paying on. */
  network: NetworkConfig;
}

export interface VerifiedPayment {
  payerAddress: string;
  nonce: string;
  chargeAmountUsdc: number;
  /**
   * The server-built requirements this payment was verified against.
   * Settlement runs on this exact object, never on the copy the client
   * embedded in its payload, and handing it forward (instead of rebuilding
   * it) keeps the Solana extra.feePayer stable across verify and settle.
   */
  requirements: PaymentRequirements;
}

export type VerifyPaymentResult =
  | ({ ok: true } & VerifiedPayment)
  | { ok: false; error: VerifyPaymentError };

export type VerifyPaymentError =
  | { kind: "malformed_header"; message: string }
  | { kind: "invalid_signature"; message: string }
  | { kind: "invalid_payment"; message: string }
  | { kind: "amount_mismatch"; expected: number; received: number }
  | { kind: "network_mismatch"; expected: string; received: string }
  | { kind: "recipient_mismatch"; expected: string; received: string }
  | { kind: "insufficient_funds"; message: string }
  | { kind: "authorization_expired"; message: string }
  | { kind: "replay_detected"; nonce: string }
  | { kind: "facilitator_error"; message: string }
  | { kind: "kyt_sanctioned"; payerAddress: string };

/**
 * Verifies a payment header against the facilitator. Does NOT settle.
 *
 * On success the result carries the payer address recovered by the
 * facilitator (not the unverified claim inside the payload) and a replay
 * nonce (see payment/paymentPayload.ts).
 */
export async function verifyPayment(
  input: VerifyPaymentInput,
): Promise<VerifyPaymentResult> {
  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = decodePaymentSignatureHeader(input.paymentHeader);
  } catch (err) {
    console.error("[verifyPayment] Failed to decode payment header:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: { kind: "malformed_header", message: "Payment header is not valid base64-encoded JSON." },
    };
  }

  // On Solana this resolves the facilitator fee payer (extra.feePayer),
  // which the facilitator's verify requires; without it the payment cannot
  // be verified, so the failure maps to facilitator_error.
  const requirementsResult = await buildPaymentRequirements({
    network: input.network,
    amountUsdc: input.amountUsdc,
    recipientAddress: input.recipientAddress,
  });
  if (!requirementsResult.ok) {
    return { ok: false, error: { kind: "facilitator_error", message: requirementsResult.message } };
  }
  const requirements = requirementsResult.requirements;

  const payloadNetwork = paymentPayload.accepted?.network;
  if (payloadNetwork && payloadNetwork !== requirements.network) {
    return {
      ok: false,
      error: { kind: "network_mismatch", expected: requirements.network, received: payloadNetwork },
    };
  }

  const payloadPayTo = paymentPayload.accepted?.payTo;
  if (payloadPayTo && !addressesMatch(input.network, payloadPayTo, requirements.payTo)) {
    return {
      ok: false,
      error: { kind: "recipient_mismatch", expected: requirements.payTo, received: payloadPayTo },
    };
  }

  try {
    const facilitator = getFacilitatorClient(input.network);
    const response = await facilitator.verify(paymentPayload, requirements);

    if (!response.isValid) {
      return {
        ok: false,
        error: buildVerifyError({
          reason: response.invalidReason,
          message: response.invalidMessage,
          payer: response.payer,
          input,
          requirements,
          payload: paymentPayload,
        }),
      };
    }

    // The payer recovered by the facilitator is the address money actually
    // moves from; wallet resolution and refunds depend on it, so a missing
    // payer is a malformed facilitator response, not "unknown".
    if (!response.payer) {
      console.error("[verifyPayment] Facilitator verify succeeded but returned no payer address.");
      return {
        ok: false,
        error: { kind: "facilitator_error", message: "Facilitator verify response is missing the payer address." },
      };
    }

    return {
      ok: true,
      payerAddress: response.payer,
      nonce: extractNonceFromPayload(paymentPayload) ?? fallbackNonceFromHeader(input.paymentHeader),
      chargeAmountUsdc: input.amountUsdc,
      requirements,
    };
  } catch (err) {
    console.error("[verifyPayment] Facilitator verify threw:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "facilitator_error",
        message: err instanceof Error ? err.message : "Unknown facilitator error during verify.",
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Settle
// ---------------------------------------------------------------------------

export interface SettlePaymentInput {
  /** The verified payment header (same one passed to verifyPayment). */
  paymentHeader: string;
  network: NetworkConfig;
  /** The requirements verifyPayment returned. Server-built, never the client's copy. */
  requirements: PaymentRequirements;
}

export type SettlePaymentResult =
  | { ok: true; txHash: string; settledAt: string }
  | { ok: false; error: SettlePaymentError };

/**
 * not_verified and insufficient_funds are definitive: the facilitator
 * rejected the payment before broadcasting, so no money moved. The other
 * two are indeterminate: a transaction may have been sent (its hash, when
 * the facilitator reported one, rides along for reconciliation).
 */
export type SettlePaymentError =
  | { kind: "not_verified"; message: string }
  | { kind: "insufficient_funds"; message: string }
  | { kind: "facilitator_error"; message: string; transaction: string | null }
  | { kind: "timeout"; message: string; transaction: string | null };

/**
 * Settles a previously verified payment on-chain against input.requirements.
 * It deliberately does NOT read payload.accepted: that field is inside the
 * base64 header the client controls, so settling on it would hand the client
 * a say in the terms of the transfer after the server priced the request.
 */
export async function settlePayment(
  input: SettlePaymentInput,
): Promise<SettlePaymentResult> {
  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = decodePaymentSignatureHeader(input.paymentHeader);
  } catch (err) {
    console.error("[settlePayment] Failed to decode header for settle:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: { kind: "not_verified", message: "Failed to decode the payment header for settlement." },
    };
  }

  try {
    const facilitator = getFacilitatorClient(input.network);
    const response = await facilitator.settle(paymentPayload, input.requirements);

    if (response.success && response.transaction) {
      return { ok: true, txHash: response.transaction, settledAt: new Date().toISOString() };
    }
    if (response.success) {
      // Success without a transaction hash cannot be recorded or refunded.
      return {
        ok: false,
        error: {
          kind: "facilitator_error",
          message: "Facilitator reported success without a transaction hash.",
          transaction: null,
        },
      };
    }

    return {
      ok: false,
      error: classifySettleFailure(response.errorReason, response.errorMessage, response.transaction),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown facilitator error during settle.";
    console.error(`[settlePayment] Facilitator settle threw: ${message}`);
    const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      ok: false,
      error: isTimeout
        ? { kind: "timeout", message, transaction: null }
        : { kind: "facilitator_error", message, transaction: null },
    };
  }
}

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------

export type RefundPaymentInput = RefundSendInput;

/**
 * confirmed: the refund landed. unconfirmed: it was sent but did not confirm
 * in time; it may still land, so it is neither refunded nor failed yet.
 * failed: nothing was sent, or the chain reverted it.
 */
export type RefundPaymentResult =
  | { status: "confirmed"; refundTxHash: string; refundedAt: string }
  | { status: "unconfirmed"; refundTxHash: string; message: string }
  | { status: "failed"; refundTxHash: string | null; message: string };

/**
 * Sends an on-chain USDC refund from the payout wallet back to the payer
 * and waits for the chain to confirm it. Callers record "refunded" only on
 * a confirmed result (charges/chargeLifecycle.refundCharge).
 */
export async function refundPayment(
  input: RefundPaymentInput,
): Promise<RefundPaymentResult> {
  if (!Number.isFinite(input.amountUsdc) || input.amountUsdc <= 0) {
    return { status: "failed", refundTxHash: null, message: "Refund amount must be a positive number." };
  }

  const sendResult = await sendRefund(input);
  if (!sendResult.ok) {
    return { status: "failed", refundTxHash: null, message: sendResult.message };
  }

  const confirmation = await confirmTransaction({
    network: input.network,
    txHash: sendResult.txHash,
    mode: "wait",
  });
  switch (confirmation.status) {
    case "confirmed":
      return { status: "confirmed", refundTxHash: sendResult.txHash, refundedAt: new Date().toISOString() };
    case "reverted":
      return { status: "failed", refundTxHash: sendResult.txHash, message: "The refund transaction reverted on-chain." };
    case "pending":
      return {
        status: "unconfirmed",
        refundTxHash: sendResult.txHash,
        message: "The refund was sent but has not confirmed yet.",
      };
  }
}

/** Picks the sender for the network's settlement lane. */
function sendRefund(input: RefundSendInput): Promise<RefundSendResult> {
  const { network } = input;
  switch (network.settlement) {
    case "celo":
      return refundCelo(input);
    case "arc_local":
      return refundArc(input);
    case "coinbase_cdp":
      return network.family === "evm" ? refundCdpEvm(input, network) : refundSolana(input);
    default: {
      const unhandledLane: never = network.settlement;
      return Promise.resolve({ ok: false, message: `No refund sender for lane ${String(unhandledLane)}.` });
    }
  }
}

// ---------------------------------------------------------------------------
// Reason classification
// ---------------------------------------------------------------------------

type VerifyReasonKind =
  | "invalid_signature"
  | "amount_mismatch"
  | "insufficient_funds"
  | "network_mismatch"
  | "recipient_mismatch"
  | "replay_detected"
  | "authorization_expired";

/**
 * Exact reason codes with a specific meaning.
 * sourceRef: @x402/evm dist/cjs/exact/facilitator/index.js (Err* constants),
 * plus the x402 core "insufficient_funds" reason.
 */
const VERIFY_REASON_KINDS: Readonly<Record<string, VerifyReasonKind>> = {
  invalid_exact_evm_signature: "invalid_signature",
  invalid_permit2_signature: "invalid_signature",
  invalid_exact_evm_authorization_value: "amount_mismatch",
  permit2_amount_mismatch: "amount_mismatch",
  insufficient_funds: "insufficient_funds",
  invalid_exact_evm_insufficient_balance: "insufficient_funds",
  permit2_insufficient_balance: "insufficient_funds",
  invalid_exact_evm_network_mismatch: "network_mismatch",
  invalid_exact_evm_recipient_mismatch: "recipient_mismatch",
  invalid_permit2_recipient_mismatch: "recipient_mismatch",
  invalid_exact_evm_nonce_already_used: "replay_detected",
  invalid_exact_evm_payload_authorization_valid_before: "authorization_expired",
  invalid_exact_evm_payload_authorization_valid_after: "authorization_expired",
  permit2_deadline_expired: "authorization_expired",
  eip2612_deadline_expired: "authorization_expired",
};

/**
 * Prefixes of payment-rejection codes. A code in these families means the
 * facilitator checked the payment and refused it: the client's problem
 * (4xx), never a facilitator outage (5xx). Solana codes from the CDP
 * facilitator land here by family.
 */
const PAYMENT_REJECTION_PREFIXES = [
  "invalid_",
  "permit2_",
  "erc20_",
  "eip2612_",
  "eip6492_",
  "unsupported_",
] as const;

/** CDP's sanctions screening reasons are not part of the x402 code set. */
const SANCTION_REASON_MARKERS = ["sanction", "kyt", "blocked"] as const;

function buildVerifyError(params: {
  reason: string | undefined;
  message: string | undefined;
  payer: string | undefined;
  input: VerifyPaymentInput;
  requirements: PaymentRequirements;
  payload: PaymentPayload;
}): VerifyPaymentError {
  const reason = params.reason ?? "";
  const displayMessage = params.message || params.reason || "Verification failed.";

  const specificKind = VERIFY_REASON_KINDS[reason];
  if (specificKind) {
    switch (specificKind) {
      case "invalid_signature":
        return { kind: "invalid_signature", message: displayMessage };
      case "amount_mismatch":
        return {
          kind: "amount_mismatch",
          expected: params.input.amountUsdc,
          received: readSignedAmountUsdc(params.payload, params.input.network),
        };
      case "insufficient_funds":
        return { kind: "insufficient_funds", message: displayMessage };
      case "network_mismatch":
        return {
          kind: "network_mismatch",
          expected: params.requirements.network,
          received: params.payload.accepted?.network ?? "unknown",
        };
      case "recipient_mismatch":
        return {
          kind: "recipient_mismatch",
          expected: params.requirements.payTo,
          received: params.payload.accepted?.payTo ?? "unknown",
        };
      case "replay_detected":
        return { kind: "replay_detected", nonce: extractNonceFromPayload(params.payload) ?? "unavailable" };
      case "authorization_expired":
        return { kind: "authorization_expired", message: displayMessage };
      default: {
        const unhandledKind: never = specificKind;
        return { kind: "facilitator_error", message: `Unhandled verify reason ${String(unhandledKind)}.` };
      }
    }
  }

  const reasonLower = reason.toLowerCase();
  if (SANCTION_REASON_MARKERS.some((marker) => reasonLower.includes(marker))) {
    return { kind: "kyt_sanctioned", payerAddress: params.payer ?? "unavailable" };
  }
  if (PAYMENT_REJECTION_PREFIXES.some((prefix) => reasonLower.startsWith(prefix))) {
    return { kind: "invalid_payment", message: displayMessage };
  }
  return { kind: "facilitator_error", message: displayMessage };
}

/**
 * Settle reasons that prove nothing was broadcast. The facilitator re-runs
 * verify inside settle, so any verify-class rejection stops it before the
 * transfer is sent. Everything else is treated as indeterminate.
 * sourceRef: @x402/evm dist/cjs/exact/facilitator/index.js, x402 core reasons
 */
const DEFINITIVE_SETTLE_REASONS: Readonly<Record<string, "not_verified" | "insufficient_funds">> = {
  insufficient_funds: "insufficient_funds",
  invalid_exact_evm_insufficient_balance: "insufficient_funds",
  permit2_insufficient_balance: "insufficient_funds",
  invalid_exact_evm_signature: "not_verified",
  invalid_exact_evm_authorization_value: "not_verified",
  invalid_exact_evm_network_mismatch: "not_verified",
  invalid_exact_evm_recipient_mismatch: "not_verified",
  invalid_exact_evm_payload_authorization_valid_before: "not_verified",
  invalid_exact_evm_payload_authorization_valid_after: "not_verified",
  invalid_exact_evm_token_name_mismatch: "not_verified",
  invalid_exact_evm_token_version_mismatch: "not_verified",
  invalid_exact_evm_missing_eip712_domain: "not_verified",
  invalid_exact_evm_eip3009_not_supported: "not_verified",
  invalid_exact_evm_scheme: "not_verified",
  invalid_exact_evm_transaction_simulation_failed: "not_verified",
  invalid_payload: "not_verified",
  invalid_payment_requirements: "not_verified",
  invalid_scheme: "not_verified",
  invalid_network: "not_verified",
  invalid_x402_version: "not_verified",
  unsupported_scheme: "not_verified",
  unsupported_payload_type: "not_verified",
};

function classifySettleFailure(
  reason: string | undefined,
  message: string | undefined,
  transaction: string | undefined,
): SettlePaymentError {
  const displayMessage = message || reason || "Settlement failed.";
  const definitiveKind = reason ? DEFINITIVE_SETTLE_REASONS[reason] : undefined;
  if (definitiveKind === "insufficient_funds") {
    return { kind: "insufficient_funds", message: displayMessage };
  }
  if (definitiveKind === "not_verified") {
    return { kind: "not_verified", message: displayMessage };
  }
  return { kind: "facilitator_error", message: displayMessage, transaction: transaction || null };
}

/** The amount the payer actually signed, for error context only. */
function readSignedAmountUsdc(payload: PaymentPayload, network: NetworkConfig): number {
  const innerPayload: unknown = payload.payload;
  let atomicAmount: unknown = payload.accepted?.amount;
  if (typeof innerPayload === "object" && innerPayload !== null && "authorization" in innerPayload) {
    const authorization: unknown = innerPayload.authorization;
    if (typeof authorization === "object" && authorization !== null && "value" in authorization) {
      atomicAmount = authorization.value;
    }
  }
  const parsedAmount = typeof atomicAmount === "string" ? Number(atomicAmount) : Number.NaN;
  return Number.isFinite(parsedAmount) ? parsedAmount / 10 ** network.usdcDecimals : 0;
}
