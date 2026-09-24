import "server-only";

/**
 * The money path every paid x402 action shares: record, settle, finalize,
 * refund, and replay. The paid middleware and /connect both run through it,
 * so the ordering rules live once:
 *   1. The pending row (with the UNIQUE nonce) exists before settle, so a
 *      replay loses the insert race and a crash leaves a row to reconcile.
 *   2. Only a definitive facilitator rejection marks the charge failed. An
 *      uncertain settle leaves it pending with a reconciliation row.
 *   3. "refunded" is recorded only after the chain confirms the refund.
 *
 * Called by: middleware/x402PaidEndpoint.ts, connect/handleConnectVerify.ts,
 *            solanaActions/postNowBlink.ts (refundCharge)
 * Tables touched: x402_charges (insert, read, update), x402_refunds (insert),
 *                 x402_reconciliation (insert)
 */

import { eq } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { x402_charges } from "@/db/schema";
import type { Json } from "@/db/schema";
import type { WalletPrincipal } from "@/lib/x402/auth/types";
import {
  markChargeFailed,
  markChargeRefunded,
  markChargeSettled,
} from "@/lib/x402/charges/chargeTransitions";
import { insertPendingX402Charge } from "@/lib/x402/charges/insertPendingX402Charge";
import { recordX402Reconciliation } from "@/lib/x402/charges/recordReconciliation";
import {
  refundPayment,
  settlePayment,
  type SettlePaymentError,
  type VerifiedPayment,
} from "@/lib/x402/facilitator";
import { addressesMatch, type NetworkConfig } from "@/lib/x402/networks";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";

/**
 * How long a pending charge can still belong to a live request, in ms. The
 * longest paid x402 route runs for 60 s (maxDuration in the app/api/x402
 * route files); past twice that, the request that inserted the charge has
 * ended and the charge waits on reconciliation instead.
 */
const PENDING_IN_FLIGHT_MS = 120_000;

// ---------------------------------------------------------------------------
// Settle
// ---------------------------------------------------------------------------

export interface SettleChargeInput {
  paymentHeader: string;
  network: NetworkConfig;
  verified: VerifiedPayment;
  principal: WalletPrincipal;
  action: string;
  amountUsdc: number;
  requestId: string;
  recipientAddress: string;
}

/**
 * What a previously presented payment turned into, for a caller replaying
 * the same authorization (typically after losing the first response).
 */
export type ChargeReplay =
  | { state: "settled"; chargeId: string; txHash: string; storedResult: Json | null }
  | { state: "in_progress"; chargeId: string }
  | { state: "closed"; chargeId: string | null };

export type SettleChargeResult =
  | { ok: true; chargeId: string; txHash: string }
  | { ok: false; reason: "replay"; replay: ChargeReplay }
  | { ok: false; reason: "charge_insert_failed"; message: string }
  | { ok: false; reason: "settle_failed"; chargeId: string; error: SettlePaymentError }
  | { ok: false; reason: "settled_unrecorded"; chargeId: string; txHash: string };

export async function settleCharge(input: SettleChargeInput): Promise<SettleChargeResult> {
  const chargeResult = await insertPendingX402Charge({
    principalId: input.principal.principalId,
    walletId: input.principal.walletId,
    action: input.action,
    amountUsdc: input.amountUsdc,
    amountUsdAtReceipt: null,
    network: input.network,
    nonce: input.verified.nonce,
    requestId: input.requestId,
    payerAddress: input.verified.payerAddress,
    recipientAddress: input.recipientAddress,
  });

  if (!chargeResult.success) {
    // No settle has happened yet, so a failed insert costs nothing.
    if (chargeResult.conflictReason === "nonce_used") {
      return {
        ok: false,
        reason: "replay",
        replay: await loadChargeReplay({
          nonce: input.verified.nonce,
          payerAddress: input.verified.payerAddress,
          action: input.action,
          network: input.network,
        }),
      };
    }
    return { ok: false, reason: "charge_insert_failed", message: chargeResult.message };
  }
  const chargeId = chargeResult.chargeId;
  const amountAtomic = usdcToAtomic(input.amountUsdc, input.network.usdcDecimals);

  const settleResult = await settlePayment({
    paymentHeader: input.paymentHeader,
    network: input.network,
    requirements: input.verified.requirements,
  });

  if (!settleResult.ok) {
    const settleError = settleResult.error;
    switch (settleError.kind) {
      case "not_verified":
      case "insufficient_funds":
        await markChargeFailed({
          chargeId,
          fromStatus: "pending",
          errorMessage: `settle_failed: ${settleError.message}`,
        });
        break;
      case "facilitator_error":
      case "timeout":
        console.error(
          `[settleCharge] CHARGE RECONCILIATION NEEDED: charge ${chargeId} settle outcome indeterminate (${settleError.kind}): ${settleError.message}`,
        );
        await recordX402Reconciliation({
          kind: "settle_indeterminate",
          chargeId,
          txHash: settleError.transaction,
          network: input.network.name,
          payerAddress: input.verified.payerAddress,
          amountAtomic,
        });
        break;
      default: {
        const unhandledError: never = settleError;
        console.error(`[settleCharge] Unhandled settle error: ${JSON.stringify(unhandledError)}`);
      }
    }
    return { ok: false, reason: "settle_failed", chargeId, error: settleError };
  }

  const settledTransition = await markChargeSettled({
    chargeId,
    txHash: settleResult.txHash,
    settledAt: settleResult.settledAt,
  });
  if (!settledTransition.success) {
    // Money moved but the row still says pending. Auto-refunding against an
    // uncertain DB state risks paying twice, so this fails closed for review.
    console.error(
      `[settleCharge] CHARGE RECONCILIATION NEEDED: charge ${chargeId} settled on-chain (tx ${settleResult.txHash}) but could not transition to settled: ${settledTransition.message}`,
    );
    await recordX402Reconciliation({
      kind: "settle_unrecorded",
      chargeId,
      txHash: settleResult.txHash,
      network: input.network.name,
      payerAddress: input.verified.payerAddress,
      amountAtomic,
    });
    return { ok: false, reason: "settled_unrecorded", chargeId, txHash: settleResult.txHash };
  }

  return { ok: true, chargeId, txHash: settleResult.txHash };
}

/**
 * The charge a replayed nonce belongs to. The nonce is bound to the payer's
 * signature, so the stored payer must match the one verify just recovered,
 * and the replay must ask for the same action the payment bought: the same
 * payment presented on another endpoint gets nothing back. A pending charge
 * older than PENDING_IN_FLIGHT_MS is closed, not in progress, so a client
 * honoring Retry-After stops retrying a settlement that is under review.
 */
async function loadChargeReplay(params: {
  nonce: string;
  payerAddress: string;
  action: string;
  network: NetworkConfig;
}): Promise<ChargeReplay> {
  const { data: chargeRows, error } = await runQuery(
    db
      .select({
        id: x402_charges.id,
        status: x402_charges.status,
        action: x402_charges.action,
        tx_hash: x402_charges.tx_hash,
        payer_address: x402_charges.payer_address,
        metadata: x402_charges.metadata,
        created_at: x402_charges.created_at,
      })
      .from(x402_charges)
      .where(eq(x402_charges.nonce, params.nonce))
      .limit(1),
  );

  const charge = chargeRows?.[0];
  if (error || !charge) {
    if (error) console.error(`[loadChargeReplay] Lookup failed: ${error.message}`);
    return { state: "closed", chargeId: null };
  }
  if (!addressesMatch(params.network, charge.payer_address, params.payerAddress)) {
    return { state: "closed", chargeId: null };
  }
  if (charge.action !== params.action) {
    return { state: "closed", chargeId: charge.id };
  }
  if (charge.status === "pending") {
    const pendingForMs = Date.now() - new Date(charge.created_at).getTime();
    return pendingForMs < PENDING_IN_FLIGHT_MS
      ? { state: "in_progress", chargeId: charge.id }
      : { state: "closed", chargeId: charge.id };
  }
  if (charge.status === "settled" && charge.tx_hash) {
    return {
      state: "settled",
      chargeId: charge.id,
      txHash: charge.tx_hash,
      storedResult: readStoredResult(charge.metadata),
    };
  }
  return { state: "closed", chargeId: charge.id };
}

/** metadata.result, the response body a settled write action returned. */
function readStoredResult(metadata: Json): Json | null {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return null;
  }
  return metadata.result ?? null;
}

// ---------------------------------------------------------------------------
// Charge record updates
// ---------------------------------------------------------------------------

export interface ChargeRecordFields {
  /** Replay copy of the response and back-references (batch_id, ...). */
  metadata?: { [key: string]: Json | undefined };
  scheduledPostId?: string;
  socialConnectionId?: string;
}

/**
 * Best-effort update of a settled charge's non-money fields. The money
 * state is already final; a failure here only loses a back-reference or the
 * replay copy, so it is logged and never changes the caller's outcome.
 */
export async function updateChargeRecord(
  chargeId: string,
  fields: ChargeRecordFields,
): Promise<void> {
  const chargeUpdate = {
    ...(fields.metadata === undefined ? {} : { metadata: fields.metadata }),
    ...(fields.scheduledPostId === undefined ? {} : { scheduled_post_id: fields.scheduledPostId }),
    ...(fields.socialConnectionId === undefined
      ? {}
      : { social_connection_id: fields.socialConnectionId }),
  };
  // Drizzle throws on an empty SET before the query runs; with no field to
  // write there is nothing to update.
  if (Object.keys(chargeUpdate).length === 0) return;

  const { error } = await runQuery(
    db.update(x402_charges).set(chargeUpdate).where(eq(x402_charges.id, chargeId)),
  );
  if (error) {
    console.error(`[updateChargeRecord] Failed to update charge ${chargeId}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------

export interface RefundChargeInput {
  chargeId: string;
  settleTxHash: string;
  payerAddress: string;
  amountUsdc: number;
  network: NetworkConfig;
  reason: string;
  principalId: string;
}

export interface RefundChargeOutcome {
  /** True once a refund transaction exists (confirmed, or sent and pending). */
  refundInitiated: boolean;
  refundTxHash: string | null;
}

/**
 * Refunds a settled charge after the paid action failed, and records the
 * outcome honestly: refunded only when confirmed; a sent but unconfirmed
 * refund stays settled with a reconciliation row the sweep resolves; a
 * failed refund marks the charge failed for manual follow-up.
 */
export async function refundCharge(input: RefundChargeInput): Promise<RefundChargeOutcome> {
  const refundResult = await refundPayment({
    payerAddress: input.payerAddress,
    amountUsdc: input.amountUsdc,
    network: input.network,
    reason: input.reason,
  });
  const reconciliationBase = {
    chargeId: input.chargeId,
    network: input.network.name,
    payerAddress: input.payerAddress,
    amountAtomic: usdcToAtomic(input.amountUsdc, input.network.usdcDecimals),
  };

  switch (refundResult.status) {
    case "confirmed": {
      const refundedTransition = await markChargeRefunded({
        chargeId: input.chargeId,
        reason: input.reason,
        refundedUsdc: input.amountUsdc,
        refundTxHash: refundResult.refundTxHash,
        initiatedBy: input.principalId,
      });
      if (!refundedTransition.success) {
        console.error(
          `[refundCharge] CHARGE RECONCILIATION NEEDED: charge ${input.chargeId} refunded on-chain (refund tx ${refundResult.refundTxHash}) but could not be recorded: ${refundedTransition.message}`,
        );
        await recordX402Reconciliation({
          kind: "refund_failed",
          txHash: refundResult.refundTxHash,
          ...reconciliationBase,
        });
      }
      return { refundInitiated: true, refundTxHash: refundResult.refundTxHash };
    }

    case "unconfirmed": {
      console.error(
        `[refundCharge] Refund for charge ${input.chargeId} sent (tx ${refundResult.refundTxHash}) but not confirmed; the reconciliation sweep records it once it lands.`,
      );
      await recordX402Reconciliation({
        kind: "refund_failed",
        txHash: refundResult.refundTxHash,
        ...reconciliationBase,
      });
      return { refundInitiated: true, refundTxHash: refundResult.refundTxHash };
    }

    case "failed": {
      console.error(
        `[refundCharge] REFUND FAILED for charge ${input.chargeId} (settle tx ${input.settleTxHash}): ${refundResult.message}`,
      );
      await recordX402Reconciliation({
        kind: "refund_failed",
        txHash: refundResult.refundTxHash,
        ...reconciliationBase,
      });
      await markChargeFailed({
        chargeId: input.chargeId,
        fromStatus: "settled",
        errorMessage: `refund_failed: ${input.reason}`,
      });
      return { refundInitiated: false, refundTxHash: null };
    }

    default: {
      const unhandledResult: never = refundResult;
      console.error(`[refundCharge] Unhandled refund result: ${JSON.stringify(unhandledResult)}`);
      return { refundInitiated: false, refundTxHash: null };
    }
  }
}
