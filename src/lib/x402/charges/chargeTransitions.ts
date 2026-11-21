import "server-only";

import { and, eq } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { x402_charges, x402_refunds } from "@/db/schema";
import { recordX402Reconciliation } from "@/lib/x402/charges/recordReconciliation";

export type ChargeTransitionResult =
  | { success: true }
  | { success: false; reason: "not_in_expected_status" | "db_error"; message: string };

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

export async function markChargeFailed(params: {
  chargeId: string;
  errorMessage: string;
}): Promise<ChargeTransitionResult> {
  const { data: updatedRows, error } = await runQuery(
    db
      .update(x402_charges)
      .set({ status: "failed", error_message: params.errorMessage })
      .where(and(eq(x402_charges.id, params.chargeId), eq(x402_charges.status, "pending")))
      .returning({ id: x402_charges.id }),
  );

  if (error) {
    console.error(`[markChargeFailed] Update failed for charge ${params.chargeId}: ${error.message}`);
    return { success: false, reason: "db_error", message: error.message };
  }
  if (updatedRows.length === 0) {
    console.error(`[markChargeFailed] Charge ${params.chargeId} was not in status "pending".`);
    return {
      success: false,
      reason: "not_in_expected_status",
      message: "Charge is not pending.",
    };
  }
  return { success: true };
}

export async function markChargeActionFailed(params: {
  chargeId: string;
  errorMessage: string;
}): Promise<ChargeTransitionResult> {
  const { data: updatedRows, error } = await runQuery(
    db
      .update(x402_charges)
      .set({ error_message: params.errorMessage })
      .where(and(eq(x402_charges.id, params.chargeId), eq(x402_charges.status, "settled")))
      .returning({ id: x402_charges.id }),
  );

  if (error) {
    console.error(`[markChargeActionFailed] Update failed for charge ${params.chargeId}: ${error.message}`);
    return { success: false, reason: "db_error", message: error.message };
  }
  if (updatedRows.length === 0) {
    console.error(`[markChargeActionFailed] Charge ${params.chargeId} was not in status "settled".`);
    return {
      success: false,
      reason: "not_in_expected_status",
      message: "Charge is not settled.",
    };
  }
  return { success: true };
}

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
