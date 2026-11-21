import "server-only";

import { decodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

import { refundArc } from "@/lib/x402/arc/refundArc";
import { refundCdpEvm } from "@/lib/x402/cdp/refundCdpEvm";
import { refundCelo } from "@/lib/x402/celo/refundCelo";
import { confirmTransaction } from "@/lib/x402/chain/confirmTransaction";
import type { RefundSendInput, RefundSendResult } from "@/lib/x402/chain/refundSender";
import { getFacilitatorClient } from "@/lib/x402/facilitatorClient";
import { buildPaymentRequirements } from "@/lib/x402/http/paymentHttp";
import { TIMEOUT_ERROR_NAME } from "@/lib/x402/http/withTimeout";
import { addressesMatch, type NetworkConfig } from "@/lib/x402/networks";
import {
  extractPaymentIdentity,
  fallbackNonceFromHeader,
} from "@/lib/x402/payment/paymentPayload";
import { refundSolana } from "@/lib/x402/solana/refundSolana";

export interface VerifyPaymentInput {
  paymentHeader: string;

  amountUsdc: number;

  recipientAddress: string;

  network: NetworkConfig;
}

export interface VerifiedPayment {
  payerAddress: string;
  nonce: string;
  chargeAmountUsdc: number;
  requirements: PaymentRequirements;
}

export type VerifyPaymentResult =
  | ({ ok: true } & VerifiedPayment)
  | { ok: false; error: VerifyPaymentError };

export interface PresentedPayment {
  nonce: string;
  payerAddress: string;
}

export type VerifyPaymentError =
  | { kind: "malformed_header"; message: string }
  | { kind: "invalid_signature"; message: string }
  | { kind: "invalid_payment"; message: string; payment: PresentedPayment | null }
  | { kind: "amount_mismatch"; expected: number; received: number }
  | { kind: "network_mismatch"; expected: string; received: string }
  | { kind: "recipient_mismatch"; expected: string; received: string }
  | { kind: "insufficient_funds"; message: string; payment: PresentedPayment | null }
  | { kind: "authorization_expired"; message: string; payment: PresentedPayment | null }
  | { kind: "replay_detected"; nonce: string; payment: PresentedPayment | null }
  | { kind: "facilitator_error"; message: string }
  | { kind: "invalid_amount"; message: string }
  | { kind: "kyt_sanctioned"; payerAddress: string };

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

  const requirementsResult = await buildPaymentRequirements({
    network: input.network,
    amountUsdc: input.amountUsdc,
    recipientAddress: input.recipientAddress,
  });
  if (!requirementsResult.ok) {
    const errorKind = requirementsResult.reason === "invalid_amount" ? "invalid_amount" : "facilitator_error";
    return { ok: false, error: { kind: errorKind, message: requirementsResult.message } };
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

  const facilitatorResult = getFacilitatorClient(input.network);
  if (!facilitatorResult.ok) {
    console.error(`[verifyPayment] No facilitator for ${input.network.displayName}: ${facilitatorResult.message}`);
    return { ok: false, error: { kind: "facilitator_error", message: facilitatorResult.message } };
  }

  try {
    const response = await facilitatorResult.client.verify(paymentPayload, requirements);

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
      nonce: extractPaymentIdentity(paymentPayload).nonce ?? fallbackNonceFromHeader(input.paymentHeader),
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

export interface SettlePaymentInput {
  paymentHeader: string;
  network: NetworkConfig;
  requirements: PaymentRequirements;
}

export type SettlePaymentResult =
  | { ok: true; txHash: string; settledAt: string }
  | { ok: false; error: SettlePaymentError };

export type SettlePaymentError =
  | { kind: "not_verified"; message: string }
  | { kind: "insufficient_funds"; message: string }
  | { kind: "facilitator_error"; message: string; transaction: string | null }
  | { kind: "timeout"; message: string; transaction: string | null };

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

  const facilitatorResult = getFacilitatorClient(input.network);
  if (!facilitatorResult.ok) {
    console.error(`[settlePayment] No facilitator for ${input.network.displayName}: ${facilitatorResult.message}`);
    return { ok: false, error: { kind: "facilitator_error", message: facilitatorResult.message, transaction: null } };
  }

  try {
    const response = await facilitatorResult.client.settle(paymentPayload, input.requirements);

    if (response.success && response.transaction) {
      return { ok: true, txHash: response.transaction, settledAt: new Date().toISOString() };
    }
    if (response.success) {
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
    const isTimeout = err instanceof Error && (err.name === TIMEOUT_ERROR_NAME || err.name === "AbortError");
    return {
      ok: false,
      error: isTimeout
        ? { kind: "timeout", message, transaction: null }
        : { kind: "facilitator_error", message, transaction: null },
    };
  }
}

export type RefundPaymentInput = RefundSendInput;

export type RefundPaymentResult =
  | { status: "confirmed"; refundTxHash: string; refundedAt: string }
  | { status: "unconfirmed"; refundTxHash: string; message: string }
  | { status: "send_unknown"; refundTxHash: string | null; message: string }
  | { status: "failed"; refundTxHash: string | null; message: string };

export async function refundPayment(
  input: RefundPaymentInput,
): Promise<RefundPaymentResult> {
  if (!Number.isFinite(input.amountUsdc) || input.amountUsdc <= 0) {
    return { status: "failed", refundTxHash: null, message: "Refund amount must be a positive number." };
  }

  const sendResult = await sendRefund(input);
  if (sendResult.status === "not_sent") {
    return { status: "failed", refundTxHash: null, message: sendResult.message };
  }
  if (sendResult.status === "outcome_unknown") {
    return { status: "send_unknown", refundTxHash: sendResult.txHash, message: sendResult.message };
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
      return Promise.resolve({ status: "not_sent", message: `No refund sender for lane ${String(unhandledLane)}.` });
    }
  }
}

type VerifyReasonKind =
  | "invalid_signature"
  | "invalid_payment"
  | "amount_mismatch"
  | "insufficient_funds"
  | "network_mismatch"
  | "recipient_mismatch"
  | "replay_detected"
  | "authorization_expired";

// Arc: @x402/evm defines these codes without exporting them (node_modules/@x402/evm/dist/cjs/exact/facilitator/index.js, Err* constants).
// CDP (Base, Polygon, Arbitrum, Solana): X402VerifyInvalidReason in node_modules/@coinbase/cdp-sdk/src/openapi-client/generated/coinbaseDeveloperPlatformAPIs.schemas.ts.
// Celo: api.x402.celo.org runs x402-rs (docs.celo.org/build-on-celo/build-with-ai/x402), whose ErrorReason is in crates/x402-types/src/proto/mod.rs.
const VERIFY_REASON_KINDS: Readonly<Record<string, VerifyReasonKind>> = {
  invalid_exact_evm_signature: "invalid_signature",
  invalid_exact_evm_payload_signature: "invalid_signature",
  invalid_permit2_signature: "invalid_signature",
  invalid_signature: "invalid_signature",
  invalid_exact_evm_authorization_value: "amount_mismatch",
  permit2_amount_mismatch: "amount_mismatch",
  invalid_payment_amount: "amount_mismatch",
  insufficient_funds: "insufficient_funds",
  invalid_exact_evm_insufficient_balance: "insufficient_funds",
  permit2_insufficient_balance: "insufficient_funds",
  invalid_exact_evm_network_mismatch: "network_mismatch",
  chain_id_mismatch: "network_mismatch",
  invalid_exact_evm_recipient_mismatch: "recipient_mismatch",
  invalid_permit2_recipient_mismatch: "recipient_mismatch",
  recipient_mismatch: "recipient_mismatch",
  invalid_exact_evm_nonce_already_used: "replay_detected",
  duplicate_settlement: "replay_detected",
  invalid_exact_evm_payload_authorization_valid_before: "authorization_expired",
  invalid_exact_evm_payload_authorization_valid_after: "authorization_expired",
  permit2_deadline_expired: "authorization_expired",
  eip2612_deadline_expired: "authorization_expired",
  invalid_payment_expired: "authorization_expired",
  invalid_payment_early: "authorization_expired",
  transaction_simulation: "invalid_payment",
  asset_mismatch: "invalid_payment",
  accepted_requirements_mismatch: "invalid_payment",
};

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
      case "invalid_payment":
        return { kind: "invalid_payment", message: displayMessage, payment: readPresentedPayment(params) };
      case "amount_mismatch":
        return {
          kind: "amount_mismatch",
          expected: params.input.amountUsdc,
          received: readSignedAmountUsdc(params.payload, params.input.network),
        };
      case "insufficient_funds":
        return { kind: "insufficient_funds", message: displayMessage, payment: readPresentedPayment(params) };
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
      case "replay_detected": {
        const payment = readPresentedPayment(params);
        return { kind: "replay_detected", nonce: payment?.nonce ?? "unavailable", payment };
      }
      case "authorization_expired":
        return { kind: "authorization_expired", message: displayMessage, payment: readPresentedPayment(params) };
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
    return { kind: "invalid_payment", message: displayMessage, payment: readPresentedPayment(params) };
  }
  return { kind: "facilitator_error", message: displayMessage };
}

function readPresentedPayment(params: {
  payer: string | undefined;
  input: VerifyPaymentInput;
  payload: PaymentPayload;
}): PresentedPayment | null {
  const identity = extractPaymentIdentity(params.payload);
  const nonce = identity.nonce ?? fallbackNonceFromHeader(params.input.paymentHeader);
  const verifiedPayer = params.payer || null;
  const signedPayer = identity.payerAddress;
  if (verifiedPayer && signedPayer && !addressesMatch(params.input.network, verifiedPayer, signedPayer)) {
    return null;
  }
  const payerAddress = verifiedPayer ?? signedPayer;
  return payerAddress ? { nonce, payerAddress } : null;
}

// @x402/evm settle re-runs verify and returns these codes with an empty transaction before
// broadcasting (node_modules/@x402/evm/dist/cjs/exact/facilitator/index.js settleEIP3009).
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
  if (transaction) {
    return {
      kind: "facilitator_error",
      message: `${displayMessage} (the facilitator reported transaction ${transaction}, so the payment may have moved)`,
      transaction,
    };
  }
  const definitiveKind = reason ? DEFINITIVE_SETTLE_REASONS[reason] : undefined;
  if (definitiveKind === "insufficient_funds") {
    return { kind: "insufficient_funds", message: displayMessage };
  }
  if (definitiveKind === "not_verified") {
    return { kind: "not_verified", message: displayMessage };
  }
  return { kind: "facilitator_error", message: displayMessage, transaction: null };
}

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
