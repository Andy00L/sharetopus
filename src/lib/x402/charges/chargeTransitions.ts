import "server-only";

import { and, eq } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { x402_charges, x402_refunds } from "@/db/schema";
import { recordX402Reconciliation } from "@/lib/x402/charges/recordReconciliation";

/**
 * Status-scoped transitions for x402_charges rows.
 *
 * Every transition includes the expected prior status in the WHERE clause
 * and checks the affected-row count, so two concurrent requests can never
 * both move the same charge (no double-settle marking, no refunded-over-
 * failed overwrites). A zero-row result means another request transitioned
 * the charge first; callers decide what that means for their flow.
 *
 * Called by: charges/chargeLifecycle.ts, solanaActions/postNowBlink.ts,
 *            inngest/functions/sweepX402ReconciliationCron.ts
 * Tables touched: x402_charges (update), x402_refunds (insert, refund path)
 *
 * All functions return errors as values. Never throw.
 */

export type ChargeTransitionResult =
  | { success: true }
  | { success: false; reason: "not_in_expected_status" | "db_error"; message: string };

/**
 * pending -> settled, recording the settlement transaction. Facilitator
 * settlements leave block number and fee null (no SettleResponse carries
 * them); the Blink path, which reads the chain itself, passes the slot.
 */
export async function markChargeSettled(params: {
  chargeId: string;
  txHash: string;
  settledAt: string;
  blockNumber?: number;
}): Promise<ChargeTransitionResult> {
  const { data: updatedRows, error } = await runQuery(
    db
      .update(x402_charges)
      .set({
        status: "settled",
        tx_hash: params.txHash,
        settled_at: params.settledAt,
        ...(params.blockNumber === undefined ? {} : { block_number: params.blockNumber }),
      })
      .where(and(eq(x402_charges.id, params.chargeId), eq(x402_charges.status, "pending")))
      .returning({ id: x402_charges.id }),
  );

  if (error) {
    console.error(`[markChargeSettled] Update failed for charge ${params.chargeId}: ${error.message}`);
    return { success: false, reason: "db_error", message: error.message };
  }
  if (updatedRows.length === 0) {
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
  const { data: updatedRows, error } = await runQuery(
    db
      .update(x402_charges)
      .set({ status: "failed", error_message: params.errorMessage })
      .where(and(eq(x402_charges.id, params.chargeId), eq(x402_charges.status, params.fromStatus)))
      .returning({ id: x402_charges.id }),
  );

  if (error) {
    console.error(`[markChargeFailed] Update failed for charge ${params.chargeId}: ${error.message}`);
    return { success: false, reason: "db_error", message: error.message };
  }
  if (updatedRows.length === 0) {
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
 * Call ONLY after the chain confirmed the refund; recording a refund that
 * never landed would permanently mark the payer as made whole. A failed
 * refund goes through markChargeFailed with a refund_failed message instead.
 */
export async function markChargeRefunded(params: {
  chargeId: string;
  reason: string;
  refundedUsdc: number;
  refundTxHash: string;
  initiatedBy: string;
}): Promise<ChargeTransitionResult> {
  const { data: updatedRows, error: updateError } = await runQuery(
    db
      .update(x402_charges)
      .set({ status: "refunded", error_message: params.reason })
      .where(and(eq(x402_charges.id, params.chargeId), eq(x402_charges.status, "settled")))
      .returning({ id: x402_charges.id }),
  );

  if (updateError) {
    console.error(`[markChargeRefunded] Update failed for charge ${params.chargeId}: ${updateError.message}`);
    return { success: false, reason: "db_error", message: updateError.message };
  }
  if (updatedRows.length === 0) {
    console.error(`[markChargeRefunded] Charge ${params.chargeId} was not in status "settled".`);
    return {
      success: false,
      reason: "not_in_expected_status",
      message: "Charge is not settled.",
    };
  }

  const { error: refundInsertError } = await runQuery(
    db.insert(x402_refunds).values({
      charge_id: params.chargeId,
      reason: params.reason,
      refunded_usdc: params.refundedUsdc,
      refund_tx_hash: params.refundTxHash,
      initiated_by: params.initiatedBy,
    }),
  );

  if (refundInsertError) {
    // The charge already says "refunded" and the refund landed; losing the
    // x402_refunds row would lose the only copy of the refund tx hash, so it
    // goes to reconciliation. Money-wise this is still a success.
    console.error(
      `[markChargeRefunded] x402_refunds insert failed for charge ${params.chargeId} (refund tx ${params.refundTxHash}): ${refundInsertError.message}`
    );
    await recordX402Reconciliation({
      kind: "refund_failed",
      chargeId: params.chargeId,
      txHash: params.refundTxHash,
    });
  }

  return { success: true };
}
