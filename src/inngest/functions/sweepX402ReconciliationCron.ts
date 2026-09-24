import "server-only";

import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { NonRetriableError } from "inngest";

import { db, runQuery } from "@/db/client";
import { x402_charges, x402_reconciliation, x402_refunds } from "@/db/schema";
import { confirmTransaction } from "@/lib/x402/chain/confirmTransaction";
import { markChargeRefunded } from "@/lib/x402/charges/chargeTransitions";
import { getNetworkConfig } from "@/lib/x402/networks";

import { inngest } from "../client";

/** How far back the sweep looks, in days. Older rows are handled by hand. */
const LOOKBACK_DAYS = 30;

/** A pending charge older than this has outlived any request that could finish it, in minutes. */
const STALE_PENDING_MINUTES = 15;

/** Upper bound on rows read per table per run. */
const MAX_ROWS_PER_RUN = 500;

/** Reason recorded when the sweep, not a request, records a refund. */
const SWEEP_REFUND_REASON = "refund confirmed on-chain by the reconciliation sweep";

interface OpenItem {
  kind: string;
  chargeId: string | null;
  txHash: string | null;
  network: string | null;
  note: string;
}

interface SweepSummary {
  reconciliationRows: number;
  stalePendingCharges: number;
  resolved: number;
  recordedRefunds: number;
  open: OpenItem[];
}

/**
 * Hourly reader for x402_reconciliation and stuck pending charges: the one
 * consumer of the trail the request path writes when it cannot close a
 * money window itself (charges/recordReconciliation.ts).
 *
 * It closes what the chain proves (a refund that landed after its request
 * stopped waiting is recorded as refunded) and fails the run while anything
 * is still open, so the Inngest dashboard and its failure alerts surface an
 * x402 money problem within the hour instead of leaving it in Vercel logs
 * that expire. Throwing is how Inngest marks a run failed, the documented
 * exception to errors-as-values for background jobs.
 *
 * Items close from the data, with no acknowledgement column: a settle item
 * closes once its charge leaves pending, a refund item once the charge has
 * an x402_refunds row. A refund sent by hand is closed by recording it
 * there. Rows with no charge to check can only age out of the
 * LOOKBACK_DAYS window.
 */
export const sweepX402ReconciliationCron = inngest.createFunction(
  {
    id: "sweep-x402-reconciliation",
    name: "Sweep x402 reconciliation rows and stuck pending charges",
    retries: 0,
    triggers: [{ cron: "20 * * * *" }],
  },
  async ({ step }) => {
    const summary = await step.run("sweep-x402-reconciliation", () => sweepReconciliation());

    console.log(
      `[sweepX402ReconciliationCron] rows=${summary.reconciliationRows} stalePending=${summary.stalePendingCharges} resolved=${summary.resolved} recordedRefunds=${summary.recordedRefunds} open=${summary.open.length}`,
    );

    if (summary.open.length > 0) {
      throw new NonRetriableError(
        `[sweepX402ReconciliationCron] ${summary.open.length} open x402 money item(s): ${JSON.stringify(summary.open.slice(0, 25))}`,
      );
    }
    return summary;
  },
);

async function sweepReconciliation(): Promise<SweepSummary> {
  const lookbackIso = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const staleCutoffIso = new Date(Date.now() - STALE_PENDING_MINUTES * 60 * 1000).toISOString();

  const { data: reconciliationRows, error: reconciliationError } = await runQuery(
    db
      .select({
        kind: x402_reconciliation.kind,
        charge_id: x402_reconciliation.charge_id,
        tx_hash: x402_reconciliation.tx_hash,
        network: x402_reconciliation.network,
      })
      .from(x402_reconciliation)
      .where(gte(x402_reconciliation.created_at, lookbackIso))
      .orderBy(asc(x402_reconciliation.created_at))
      .limit(MAX_ROWS_PER_RUN),
  );
  if (reconciliationError) {
    throw new Error(`[sweepReconciliation] x402_reconciliation read failed: ${reconciliationError.message}`);
  }

  const { data: stalePendingCharges, error: staleError } = await runQuery(
    db
      .select({ id: x402_charges.id, network: x402_charges.network, tx_hash: x402_charges.tx_hash })
      .from(x402_charges)
      .where(
        and(
          eq(x402_charges.status, "pending"),
          gte(x402_charges.created_at, lookbackIso),
          lt(x402_charges.created_at, staleCutoffIso),
        ),
      )
      .limit(MAX_ROWS_PER_RUN),
  );
  if (staleError) {
    throw new Error(`[sweepReconciliation] stale pending read failed: ${staleError.message}`);
  }

  const chargeIds = [
    ...new Set(
      reconciliationRows
        .map((row) => row.charge_id)
        .filter((chargeId): chargeId is string => chargeId !== null),
    ),
  ];
  const chargesById = new Map<
    string,
    { id: string; status: string; network: string; amount_usdc: number; principal_id: string }
  >();
  const refundedChargeIds = new Set<string>();
  if (chargeIds.length > 0) {
    const { data: charges, error: chargesError } = await runQuery(
      db
        .select({
          id: x402_charges.id,
          status: x402_charges.status,
          network: x402_charges.network,
          amount_usdc: x402_charges.amount_usdc,
          principal_id: x402_charges.principal_id,
        })
        .from(x402_charges)
        .where(inArray(x402_charges.id, chargeIds)),
    );
    if (chargesError) {
      throw new Error(`[sweepReconciliation] x402_charges read failed: ${chargesError.message}`);
    }
    for (const charge of charges) chargesById.set(charge.id, charge);

    const { data: refunds, error: refundsError } = await runQuery(
      db
        .select({ charge_id: x402_refunds.charge_id })
        .from(x402_refunds)
        .where(inArray(x402_refunds.charge_id, chargeIds)),
    );
    if (refundsError) {
      throw new Error(`[sweepReconciliation] x402_refunds read failed: ${refundsError.message}`);
    }
    for (const refund of refunds) refundedChargeIds.add(refund.charge_id);
  }

  const summary: SweepSummary = {
    reconciliationRows: reconciliationRows.length,
    stalePendingCharges: stalePendingCharges.length,
    resolved: 0,
    recordedRefunds: 0,
    open: [],
  };
  const chargesWithOpenItems = new Set<string>();
  const markOpen = (item: OpenItem) => {
    if (item.chargeId) {
      if (chargesWithOpenItems.has(item.chargeId)) return;
      chargesWithOpenItems.add(item.chargeId);
    }
    summary.open.push(item);
  };

  for (const row of reconciliationRows) {
    const charge = row.charge_id ? chargesById.get(row.charge_id) : undefined;
    const openItem: OpenItem = {
      kind: row.kind,
      chargeId: row.charge_id,
      txHash: row.tx_hash,
      network: row.network,
      note: "",
    };

    if (!charge) {
      markOpen({ ...openItem, note: "No charge row to reconcile against; review by hand." });
      continue;
    }

    if (row.kind === "settle_indeterminate" || row.kind === "settle_unrecorded") {
      if (charge.status === "pending") {
        markOpen({ ...openItem, note: "Charge still pending: decide whether the money moved and refund if so." });
      } else {
        summary.resolved += 1;
      }
      continue;
    }

    // refund_failed: resolved once a refund is on record for the charge.
    if (refundedChargeIds.has(charge.id)) {
      summary.resolved += 1;
      continue;
    }
    if (!row.tx_hash) {
      // A send whose reply was lost also lands here, so the refund may have
      // gone out anyway; refunding again blind could pay the payer twice.
      markOpen({
        ...openItem,
        note: "No refund transaction hash was recorded. Check the sender wallet's outgoing transfers to the payer before refunding by hand.",
      });
      continue;
    }

    const network = getNetworkConfig(charge.network);
    if (!network) {
      markOpen({ ...openItem, note: `Unknown network "${charge.network}" on the charge.` });
      continue;
    }
    const confirmation = await confirmTransaction({ network, txHash: row.tx_hash, mode: "check" });
    if (confirmation.status !== "confirmed") {
      markOpen({ ...openItem, note: `Refund transaction is ${confirmation.status}.` });
      continue;
    }

    const recorded = await recordConfirmedRefund(charge, row.tx_hash);
    if (recorded) {
      summary.recordedRefunds += 1;
      summary.resolved += 1;
    } else {
      markOpen({
        ...openItem,
        note: `Refund landed but could not be recorded (charge status ${charge.status}).`,
      });
    }
  }

  const chargesWithRows = new Set(chargeIds);
  for (const staleCharge of stalePendingCharges) {
    if (chargesWithRows.has(staleCharge.id)) continue;
    markOpen({
      kind: "stale_pending",
      chargeId: staleCharge.id,
      txHash: staleCharge.tx_hash,
      network: staleCharge.network,
      note: `Pending for over ${STALE_PENDING_MINUTES} minutes with no reconciliation row; the request likely died mid-settle.`,
    });
  }

  return summary;
}

/**
 * Records a refund the chain confirmed after its request stopped waiting.
 * A settled charge moves to refunded (which writes x402_refunds); a charge
 * already marked refunded only gets its missing x402_refunds row. Anything
 * else is left for a human.
 */
async function recordConfirmedRefund(
  charge: { id: string; status: string; amount_usdc: number; principal_id: string },
  refundTxHash: string,
): Promise<boolean> {
  if (charge.status === "settled") {
    const transition = await markChargeRefunded({
      chargeId: charge.id,
      reason: SWEEP_REFUND_REASON,
      refundedUsdc: charge.amount_usdc,
      refundTxHash,
      initiatedBy: charge.principal_id,
    });
    return transition.success;
  }
  if (charge.status === "refunded") {
    const { error } = await runQuery(
      db.insert(x402_refunds).values({
        charge_id: charge.id,
        reason: SWEEP_REFUND_REASON,
        refunded_usdc: charge.amount_usdc,
        refund_tx_hash: refundTxHash,
        initiated_by: charge.principal_id,
      }),
    );
    if (error) {
      console.error(`[recordConfirmedRefund] x402_refunds insert failed for charge ${charge.id}: ${error.message}`);
      return false;
    }
    return true;
  }
  return false;
}
