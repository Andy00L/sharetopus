import "server-only";

import { db, runQuery } from "@/db/client";
import { x402_reconciliation } from "@/db/schema";

/**
 * Durable trail for every money window the request path cannot close by
 * itself. Each case writes one x402_reconciliation row, and the hourly sweep
 * (inngest/functions/sweepX402ReconciliationCron.ts) reads them back, closes
 * what the chain proves, and alerts on the rest.
 *
 * The kinds are fixed by x402_reconciliation_kind_check. tx_hash is the
 * transaction the row is about:
 *   - settle_indeterminate: settle outcome unknown (timeout, transport, a
 *     reverted broadcast); tx_hash is the settlement transaction when the
 *     facilitator reported one.
 *   - settle_unrecorded: settled on-chain but the charge row could not be
 *     transitioned; tx_hash is the settlement transaction.
 *   - refund_failed: the request could not finish a refund it owed. tx_hash
 *     is the refund transaction when one was sent (reverted, not yet
 *     confirmed, or landed but unrecorded), null when nothing was sent. The
 *     sweep resolves the row from that transaction's on-chain state.
 *
 * Best-effort: this never throws and never changes the caller's outcome. A
 * failed insert is logged, and the console.error at each call site remains
 * the backstop.
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
    const { error } = await runQuery(
      db.insert(x402_reconciliation).values({
        kind: entry.kind,
        charge_id: entry.chargeId ?? null,
        tx_hash: entry.txHash ?? null,
        payer_address: entry.payerAddress ?? null,
        amount_atomic: entry.amountAtomic ?? null,
        network: entry.network ?? null,
      }),
    );
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
