import "server-only";

import { sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { x402_reconciliation, type X402_RECONCILIATION_KINDS } from "@/db/schema";

export type ReconciliationKind = (typeof X402_RECONCILIATION_KINDS)[number];

export async function recordX402Reconciliation(entry: {
  kind: ReconciliationKind;
  chargeId: string;
  txHash?: string | null;
  payerAddress?: string | null;
  amountAtomic?: string | null;
  network?: string | null;
}): Promise<void> {
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
}

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
