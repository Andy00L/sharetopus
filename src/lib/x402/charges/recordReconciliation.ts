import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";

/**
 * Durable reconciliation trail for the "settled but not finalized" money
 * windows. On Vercel the console lines that used to be the only record are
 * ephemeral, so each of these cases also writes one row to
 * x402_reconciliation for a human (or a future job) to resolve:
 *
 *   - settle_indeterminate: settle outcome unknown (timeout / transport);
 *     the payment may or may not have landed on-chain.
 *   - settle_unrecorded: settled on-chain but the charge row could not be
 *     transitioned; money moved, DB says pending.
 *   - refund_failed: a refund was owed after settlement but the on-chain
 *     refund did not complete; the payer is not made whole.
 *
 * Best-effort and fire-and-forget: this never throws and never changes the
 * caller's outcome. A failed insert is logged and the loud console.error at
 * each call site remains the backstop.
 */
export type ReconciliationKind =
  | "settle_indeterminate"
  | "settle_unrecorded"
  | "refund_failed";

export async function recordX402Reconciliation(entry: {
  kind: ReconciliationKind;
  chargeId?: string | null;
  txHash?: string | null;
  payerAddress?: string | null;
  amountAtomic?: string | null;
  network?: string | null;
}): Promise<void> {
  try {
    const { error } = await adminSupabase.from("x402_reconciliation").insert({
      kind: entry.kind,
      charge_id: entry.chargeId ?? null,
      tx_hash: entry.txHash ?? null,
      payer_address: entry.payerAddress ?? null,
      amount_atomic: entry.amountAtomic ?? null,
      network: entry.network ?? null,
    });
    if (error) {
      console.error(
        `[recordX402Reconciliation] insert failed for kind=${entry.kind} charge=${entry.chargeId ?? "n/a"}: ${error.message}`,
      );
    }
  } catch (err) {
    console.error(
      `[recordX402Reconciliation] threw for kind=${entry.kind}: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }
}
