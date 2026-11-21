import "server-only";

import { sql } from "drizzle-orm";

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
 *     is the refund transaction when one is known (reverted, not yet
 *     confirmed, signed but with an unknown delivery, or landed but
 *     unrecorded); the sweep resolves the row from that transaction's
 *     on-chain state. A null tx_hash means none is known: nothing was sent,
 *     or a CDP send timed out and may still have gone out, so the sender
 *     wallet's outgoing transfers decide.
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
  chargeId: string;
  txHash?: string | null;
  payerAddress?: string | null;
  amountAtomic?: string | null;
  network?: string | null;
}): Promise<void> {
  try {
    const { error } = await runQuery(
      db.insert(x402_reconciliation).values({
        kind: entry.kind,
        charge_id: entry.chargeId,
        tx_hash: entry.txHash ?? null,
        payer_address: entry.payerAddress ?? null,
        amount_atomic: entry.amountAtomic ?? null,
        network: entry.network ?? null,
      }),
    );
    if (error) {
      console.error(
        `[recordX402Reconciliation] insert failed for kind=${entry.kind} charge=${entry.chargeId}: ${error.message}`,
      );
    }
  } catch (err) {
    console.error(
      `[recordX402Reconciliation] threw for kind=${entry.kind}: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }
}

/**
 * A payment that reached Sharetopus with no charge to hold it (the Blink's
 * unknown wallet and underpayment cases), as a settle_unrecorded row with no
 * charge id. One row per transaction: a client retrying with the same
 * signature finds the row and writes nothing. The target-less ON CONFLICT
 * DO NOTHING is a no-op until a unique index on (kind, tx_hash) for
 * charge-less rows exists, and then also absorbs two retries that race.
 * Best-effort like recordX402Reconciliation.
 */
export async function recordUnchargedPayment(entry: {
  txHash: string;
  payerAddress: string;
  amountAtomic: string;
  network: string;
}): Promise<void> {
  const kind: ReconciliationKind = "settle_unrecorded";
  const { error } = await runQuery(
    db.execute(sql`
      insert into ${x402_reconciliation} (
        ${sql.identifier(x402_reconciliation.kind.name)},
        ${sql.identifier(x402_reconciliation.tx_hash.name)},
        ${sql.identifier(x402_reconciliation.payer_address.name)},
        ${sql.identifier(x402_reconciliation.amount_atomic.name)},
        ${sql.identifier(x402_reconciliation.network.name)}
      )
      select ${kind}::text, ${entry.txHash}::text, ${entry.payerAddress}::text, ${entry.amountAtomic}::text, ${entry.network}::text
      where not exists (
        select 1 from ${x402_reconciliation}
        where ${x402_reconciliation.kind} = ${kind}::text
          and ${x402_reconciliation.tx_hash} = ${entry.txHash}::text
          and ${x402_reconciliation.charge_id} is null
      )
      on conflict do nothing
    `),
  );
  if (error) {
    console.error(
      `[recordUnchargedPayment] insert failed for tx ${entry.txHash} on ${entry.network}: ${error.message}`,
    );
  }
}
