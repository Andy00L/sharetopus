import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";

/**
 * Status-scoped transitions for x402_charges rows.
 *
 * Every transition includes the expected prior status in the WHERE clause
 * and checks the affected-row count, so two concurrent requests can never
 * both move the same charge (no double-settle marking, no refunded-over-
 * failed overwrites). A zero-row result means another request transitioned
 * the charge first; callers decide what that means for their flow.
 *
 * Called by: x402PaidEndpoint (steps 10-13)
 * Tables touched: x402_charges (update), x402_refunds (insert, refund path)
 *
 * All functions return errors as values. Never throw.
 */

export type ChargeTransitionResult =
  | { success: true }
  | { success: false; reason: "not_in_expected_status" | "db_error"; message: string };

/** pending -> settled, recording the on-chain settlement facts. */
export async function markChargeSettled(params: {
  chargeId: string;
  txHash: string;
  blockNumber: number | null;
  facilitatorFeeUsdc: number | null;
  settledAt: string;
}): Promise<ChargeTransitionResult> {
  const { data: updatedRows, error } = await adminSupabase
    .from("x402_charges")
    .update({
      status: "settled",
      tx_hash: params.txHash,
      block_number: params.blockNumber,
      facilitator_fee_usdc: params.facilitatorFeeUsdc,
      settled_at: params.settledAt,
    })
    .eq("id", params.chargeId)
    .eq("status", "pending")
    .select("id");

  if (error) {
    console.error(`[markChargeSettled] Update failed for charge ${params.chargeId}: ${error.message}`);
    return { success: false, reason: "db_error", message: error.message };
  }
  if (!updatedRows || updatedRows.length === 0) {
    console.error(`[markChargeSettled] Charge ${params.chargeId} was not in status "pending".`);
    return {
      success: false,
      reason: "not_in_expected_status",
      message: "Charge is not pending.",
    };
  }
  return { success: true };
}

/** pending|settled -> failed, with the failure cause persisted. */
export async function markChargeFailed(params: {
  chargeId: string;
  fromStatus: "pending" | "settled";
  errorMessage: string;
}): Promise<ChargeTransitionResult> {
  const { data: updatedRows, error } = await adminSupabase
    .from("x402_charges")
    .update({ status: "failed", error_message: params.errorMessage })
    .eq("id", params.chargeId)
    .eq("status", params.fromStatus)
    .select("id");

  if (error) {
    console.error(`[markChargeFailed] Update failed for charge ${params.chargeId}: ${error.message}`);
    return { success: false, reason: "db_error", message: error.message };
  }
  if (!updatedRows || updatedRows.length === 0) {
    console.error(`[markChargeFailed] Charge ${params.chargeId} was not in status "${params.fromStatus}".`);
    return {
      success: false,
      reason: "not_in_expected_status",
      message: `Charge is not ${params.fromStatus}.`,
    };
  }
  return { success: true };
}

/**
 * settled -> refunded, plus the x402_refunds audit row.
 *
 * Call ONLY after the on-chain refund actually succeeded; recording a
 * refund that never happened would permanently mark the payer as made
 * whole. A failed on-chain refund goes through markChargeFailed with a
 * refund-failed error message instead, flagging the charge for manual
 * reconciliation.
 */
export async function markChargeRefunded(params: {
  chargeId: string;
  reason: string;
  refundedUsdc: number;
  refundTxHash: string;
  initiatedBy: string;
}): Promise<ChargeTransitionResult> {
  const { data: updatedRows, error: updateError } = await adminSupabase
    .from("x402_charges")
    .update({ status: "refunded", error_message: params.reason })
    .eq("id", params.chargeId)
    .eq("status", "settled")
    .select("id");

  if (updateError) {
    console.error(`[markChargeRefunded] Update failed for charge ${params.chargeId}: ${updateError.message}`);
    return { success: false, reason: "db_error", message: updateError.message };
  }
  if (!updatedRows || updatedRows.length === 0) {
    console.error(`[markChargeRefunded] Charge ${params.chargeId} was not in status "settled".`);
    return {
      success: false,
      reason: "not_in_expected_status",
      message: "Charge is not settled.",
    };
  }

  const { error: refundInsertError } = await adminSupabase
    .from("x402_refunds")
    .insert({
      charge_id: params.chargeId,
      reason: params.reason,
      refunded_usdc: params.refundedUsdc,
      refund_tx_hash: params.refundTxHash,
      initiated_by: params.initiatedBy,
    });

  if (refundInsertError) {
    // The charge already says "refunded" and the on-chain refund happened;
    // losing the x402_refunds row is an audit gap, not a money error, so
    // log loudly (with the tx hash for reconciliation) and report success.
    console.error(
      `[markChargeRefunded] x402_refunds insert failed for charge ${params.chargeId} (refund tx ${params.refundTxHash}): ${refundInsertError.message}`
    );
  }

  return { success: true };
}
