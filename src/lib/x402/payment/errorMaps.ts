import "server-only";

/**
 * Shared mapping from the facilitator wrapper's typed errors to the flow
 * error vocabulary used by the register and connect verify handlers. Both
 * RegisterVerifyError and ConnectVerifyError embed these unions, so the
 * mapping exists exactly once and a new facilitator error kind fails to
 * compile here instead of silently diverging between flows.
 *
 * Called by: handleRegisterVerify, handleRegisterSolanaVerify,
 *            handleConnectVerify
 * Tables touched: none
 */

import type {
  VerifyPaymentError,
  SettlePaymentError,
} from "@/lib/x402/facilitator";

export type MappedVerifyError =
  | { kind: "malformed_payment"; message: string }
  | { kind: "verify_invalid_signature"; message: string }
  | { kind: "verify_amount_mismatch"; message: string }
  | { kind: "verify_network_mismatch"; message: string }
  | { kind: "verify_recipient_mismatch"; message: string }
  | { kind: "verify_replay_detected"; message: string }
  | { kind: "verify_kyt_sanctioned"; message: string }
  | { kind: "verify_facilitator_error"; message: string };

export type MappedSettleError =
  | { kind: "settle_not_verified"; message: string }
  | { kind: "settle_insufficient_funds"; message: string }
  | { kind: "settle_facilitator_error"; message: string }
  | { kind: "settle_timeout"; message: string };

export function mapVerifyPaymentError(
  error: VerifyPaymentError
): MappedVerifyError {
  switch (error.kind) {
    case "malformed_header":
      return { kind: "malformed_payment", message: error.message };
    case "invalid_signature":
      return { kind: "verify_invalid_signature", message: error.message };
    case "amount_mismatch":
      return {
        kind: "verify_amount_mismatch",
        message: `Expected ${error.expected} USDC, received ${error.received} USDC.`,
      };
    case "network_mismatch":
      return {
        kind: "verify_network_mismatch",
        message: `Expected network ${error.expected}, received ${error.received}.`,
      };
    case "recipient_mismatch":
      return {
        kind: "verify_recipient_mismatch",
        message: `Expected recipient ${error.expected}, received ${error.received}.`,
      };
    case "replay_detected":
      return {
        kind: "verify_replay_detected",
        message: `Payment nonce ${error.nonce} has already been used.`,
      };
    case "kyt_sanctioned":
      return {
        kind: "verify_kyt_sanctioned",
        message: `Payer ${error.payerAddress} is flagged by sanctions screening.`,
      };
    case "facilitator_error":
      return { kind: "verify_facilitator_error", message: error.message };
  }
}

export function mapSettlePaymentError(
  error: SettlePaymentError
): MappedSettleError {
  switch (error.kind) {
    case "not_verified":
      return { kind: "settle_not_verified", message: error.message };
    case "insufficient_funds":
      return { kind: "settle_insufficient_funds", message: error.message };
    case "facilitator_error":
      return { kind: "settle_facilitator_error", message: error.message };
    case "timeout":
      return { kind: "settle_timeout", message: error.message };
  }
}
