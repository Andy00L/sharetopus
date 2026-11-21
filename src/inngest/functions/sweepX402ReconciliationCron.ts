import "server-only";

import { and, asc, eq, gte, inArray, isNull, like, lt, notExists, sql } from "drizzle-orm";
import { NonRetriableError } from "inngest";

import { db, runQuery } from "@/db/client";
import { x402_charges, x402_reconciliation, x402_refunds } from "@/db/schema";
import { confirmTransaction } from "@/lib/x402/chain/confirmTransaction";
import { markChargeRefunded } from "@/lib/x402/charges/chargeTransitions";
import { POST_ACTION_PREFIX } from "@/lib/x402/middleware/resolvePostAction";
import { getNetworkConfig } from "@/lib/x402/networks";

import { inngest } from "../client";
import { decideReconciliationRow } from "./x402ReconciliationDecision";

const LOOKBACK_DAYS = 30;

const STALE_PENDING_MINUTES = 15;

const MAX_ROWS_PER_RUN = 500;

const SWEEP_REFUND_REASON = "refund confirmed on-chain by the reconciliation sweep";

const ACTION_FAILED_MARKER_PATTERN = "action_failed:%";

const POST_ACTION_PATTERN = `${POST_ACTION_PREFIX}%`;

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
  unrecordedActionFailures: number;
  settledWithoutOutcome: number;
  resolved: number;
  recordedRefunds: number;
  open: OpenItem[];
}

// Throwing is how Inngest marks a run failed, the documented exception to
// errors-as-values for background jobs:
// https://www.inngest.com/docs/guides/error-handling
export const sweepX402ReconciliationCron = inngest.createFunction(
  {
    id: "sweep-x402-reconciliation",
    name: "Sweep x402 reconciliation rows and stuck pending charges",
    retries: 2,
    triggers: [{ cron: "20 * * * *" }],
  },
  async ({ step }) => {
    const summary = await step.run("sweep-x402-reconciliation", () => sweepReconciliation());

    console.log(
      `[sweepX402ReconciliationCron] rows=${summary.reconciliationRows} stalePending=${summary.stalePendingCharges} unrecordedActionFailures=${summary.unrecordedActionFailures} settledWithoutOutcome=${summary.settledWithoutOutcome} resolved=${summary.resolved} recordedRefunds=${summary.recordedRefunds} open=${summary.open.length}`,
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

  const { data: unrecordedActionFailures, error: actionFailedError } = await runQuery(
    db
      .select({ id: x402_charges.id, network: x402_charges.network, tx_hash: x402_charges.tx_hash })
      .from(x402_charges)
      .where(
        and(
          eq(x402_charges.status, "settled"),
          like(x402_charges.error_message, ACTION_FAILED_MARKER_PATTERN),
          gte(x402_charges.created_at, lookbackIso),
          lt(x402_charges.created_at, staleCutoffIso),
          hasNoRefundOrReconciliation(),
        ),
      )
      .limit(MAX_ROWS_PER_RUN),
  );
  if (actionFailedError) {
    throw new Error(`[sweepReconciliation] action_failed read failed: ${actionFailedError.message}`);
  }

  const { data: settledWithoutOutcome, error: settledWithoutOutcomeError } = await runQuery(
    db
      .select({ id: x402_charges.id, network: x402_charges.network, tx_hash: x402_charges.tx_hash })
      .from(x402_charges)
      .where(
        and(
          eq(x402_charges.status, "settled"),
          like(x402_charges.action, POST_ACTION_PATTERN),
          isNull(x402_charges.error_message),
          isNull(sql`${x402_charges.metadata} -> 'result'`),
          isNull(sql`${x402_charges.metadata} -> 'batch_id'`),
          isNull(x402_charges.scheduled_post_id),
          gte(x402_charges.created_at, lookbackIso),
          lt(x402_charges.created_at, staleCutoffIso),
          hasNoRefundOrReconciliation(),
        ),
      )
      .limit(MAX_ROWS_PER_RUN),
  );
  if (settledWithoutOutcomeError) {
    throw new Error(
      `[sweepReconciliation] settled-without-outcome read failed: ${settledWithoutOutcomeError.message}`,
    );
  }

  const chargeIds = [
    ...new Set(
      reconciliationRows
        .map((row) => row.charge_id)
        .filter((chargeId): chargeId is string => chargeId !== null),
    ),
  ];

  const unchargedPaymentTxHashes = [
    ...new Set(
      reconciliationRows
        .filter((row) => row.charge_id === null)
        .map((row) => row.tx_hash)
        .filter((txHash): txHash is string => txHash !== null),
    ),
  ];
  const chargedPaymentTxHashes = new Set<string>();
  if (unchargedPaymentTxHashes.length > 0) {
    const { data: chargesHoldingPayments, error: chargesHoldingError } = await runQuery(
      db
        .select({ nonce: x402_charges.nonce })
        .from(x402_charges)
        .where(inArray(x402_charges.nonce, unchargedPaymentTxHashes)),
    );
    if (chargesHoldingError) {
      throw new Error(`[sweepReconciliation] charge lookup by payment tx failed: ${chargesHoldingError.message}`);
    }
    for (const charge of chargesHoldingPayments) chargedPaymentTxHashes.add(charge.nonce);
  }
  const chargesById = new Map<
    string,
    Pick<
      typeof x402_charges.$inferSelect,
      "id" | "status" | "network" | "amount_usdc" | "principal_id"
    >
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
    unrecordedActionFailures: unrecordedActionFailures.length,
    settledWithoutOutcome: settledWithoutOutcome.length,
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
      if (row.charge_id === null && row.tx_hash !== null && chargedPaymentTxHashes.has(row.tx_hash)) {
        summary.resolved += 1;
        continue;
      }
      markOpen({ ...openItem, note: "No charge row to reconcile against; review by hand." });
      continue;
    }

    const decision = decideReconciliationRow({
      row,
      chargeStatus: charge.status,
      isRefundRecorded: refundedChargeIds.has(charge.id),
    });
    if (decision.kind === "resolved") {
      summary.resolved += 1;
      continue;
    }
    if (decision.kind === "open") {
      markOpen({ ...openItem, note: decision.note });
      continue;
    }

    const network = getNetworkConfig(charge.network);
    if (!network) {
      markOpen({ ...openItem, note: `Unknown network "${charge.network}" on the charge.` });
      continue;
    }
    const confirmation = await confirmTransaction({ network, txHash: decision.txHash, mode: "check" });
    if (confirmation.status !== "confirmed") {
      markOpen({ ...openItem, note: `Refund transaction is ${confirmation.status}.` });
      continue;
    }

    const recorded = await recordConfirmedRefund(charge, decision.txHash);
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

  for (const failedCharge of unrecordedActionFailures) {
    markOpen({
      kind: "action_failed_unrecorded",
      chargeId: failedCharge.id,
      txHash: failedCharge.tx_hash,
      network: failedCharge.network,
      note: `Charge created over ${STALE_PENDING_MINUTES} minutes ago, its paid action failed, and it has no refund and no reconciliation row; the request likely died before the refund was recorded. Check the sender wallet's outgoing transfers to the payer before refunding by hand.`,
    });
  }

  for (const unknownCharge of settledWithoutOutcome) {
    markOpen({
      kind: "action_outcome_unknown",
      chargeId: unknownCharge.id,
      txHash: unknownCharge.tx_hash,
      network: unknownCharge.network,
      note: `Post charge settled over ${STALE_PENDING_MINUTES} minutes ago with no stored result, no batch or post link, no failure marker, no refund and no reconciliation row; the request likely died between settlement and its action. Look for a post by this principal created right after the charge before refunding by hand.`,
    });
  }

  return summary;
}

function hasNoRefundOrReconciliation() {
  return and(
    notExists(
      db
        .select({ charge_id: x402_refunds.charge_id })
        .from(x402_refunds)
        .where(eq(x402_refunds.charge_id, x402_charges.id)),
    ),
    notExists(
      db
        .select({ charge_id: x402_reconciliation.charge_id })
        .from(x402_reconciliation)
        .where(eq(x402_reconciliation.charge_id, x402_charges.id)),
    ),
  );
}

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
