import "server-only";

import { and, eq, exists, sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { x402_charges, x402_reconciliation } from "@/db/schema";
import type { Json } from "@/db/schema";
import type { WalletPrincipal } from "@/lib/x402/auth/types";
import {
  markChargeActionFailed,
  markChargeFailed,
  markChargeRefunded,
  markChargeSettled,
  type ChargeTransitionResult,
} from "@/lib/x402/charges/chargeTransitions";
import { insertPendingX402Charge } from "@/lib/x402/charges/insertPendingX402Charge";
import { recordX402Reconciliation } from "@/lib/x402/charges/recordReconciliation";
import { runWriteWithOneRetry } from "@/lib/x402/db/runWriteWithOneRetry";
import {
  refundPayment,
  settlePayment,
  type SettlePaymentError,
  type VerifiedPayment,
} from "@/lib/x402/facilitator";
import { addressesMatch, type NetworkConfig } from "@/lib/x402/networks";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";

const PENDING_IN_FLIGHT_MS = 120_000;

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
  const amountAtomic = input.verified.requirements.amount;

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
        error_message: x402_charges.error_message,
        payer_address: x402_charges.payer_address,
        metadata: x402_charges.metadata,
        created_at: x402_charges.created_at,
        has_refund_reconciliation: sql<boolean>`${exists(
          db
            .select({ id: x402_reconciliation.id })
            .from(x402_reconciliation)
            .where(
              and(
                eq(x402_reconciliation.charge_id, x402_charges.id),
                eq(x402_reconciliation.kind, "refund_failed"),
              ),
            ),
        )}`.mapWith(Boolean),
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
  const hasActionFailed = charge.error_message !== null || charge.has_refund_reconciliation;
  if (charge.status === "settled" && charge.tx_hash && !hasActionFailed) {
    return {
      state: "settled",
      chargeId: charge.id,
      txHash: charge.tx_hash,
      storedResult: readStoredResult(charge.metadata),
    };
  }
  return { state: "closed", chargeId: charge.id };
}

function readStoredResult(metadata: Json): Json | null {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return null;
  }
  return metadata.result ?? null;
}

export interface ChargeRecordFields {
  metadata?: { [key: string]: Json | undefined };
  scheduledPostId?: string;
  socialConnectionId?: string;
}

export type ChargeRecordWriteResult = { ok: true } | { ok: false; message: string };

export async function updateChargeRecord(
  chargeId: string,
  fields: ChargeRecordFields,
): Promise<ChargeRecordWriteResult> {
  const chargeUpdate = {
    ...(fields.metadata === undefined ? {} : { metadata: fields.metadata }),
    ...(fields.scheduledPostId === undefined ? {} : { scheduled_post_id: fields.scheduledPostId }),
    ...(fields.socialConnectionId === undefined
      ? {}
      : { social_connection_id: fields.socialConnectionId }),
  };
  if (Object.keys(chargeUpdate).length === 0) return { ok: true };

  const { error } = await runWriteWithOneRetry(() =>
    db.update(x402_charges).set(chargeUpdate).where(eq(x402_charges.id, chargeId)),
  );
  return error ? { ok: false, message: error.message } : { ok: true };
}

export interface RefundChargeInput {
  chargeId: string;
  settleTxHash: string;
  payerAddress: string;
  amountUsdc: number;
  network: NetworkConfig;
  reason: string;
  principalId: string;
}

export type RefundChargeOutcome =
  | { refundInitiated: true; refundConfirmed: true; refundTxHash: string }
  | { refundInitiated: true; refundConfirmed: false; refundTxHash: string }
  | { refundInitiated: false; refundConfirmed: false; refundTxHash: null };

const REFUND_NOT_SENT: RefundChargeOutcome = {
  refundInitiated: false,
  refundConfirmed: false,
  refundTxHash: null,
};

export async function refundCharge(input: RefundChargeInput): Promise<RefundChargeOutcome> {
  const refundAtomicAmount = usdcToAtomic(input.amountUsdc, input.network.usdcDecimals);
  const reconciliationBase = {
    chargeId: input.chargeId,
    network: input.network.name,
    payerAddress: input.payerAddress,
    amountAtomic: refundAtomicAmount.ok ? refundAtomicAmount.atomicAmount.toString() : null,
  };

  const markerWrite = await writeActionFailedMarker({
    chargeId: input.chargeId,
    errorMessage: `action_failed: ${input.reason}`,
  });
  if (!markerWrite.success && markerWrite.reason === "not_in_expected_status") {
    console.error(
      `[refundCharge] CHARGE RECONCILIATION NEEDED: charge ${input.chargeId} is no longer settled, so no refund was sent (another writer moved it; a second refund could pay twice).`,
    );
    await recordX402Reconciliation({ kind: "refund_failed", txHash: null, ...reconciliationBase });
    return REFUND_NOT_SENT;
  }
  if (!markerWrite.success) {
    console.error(
      `[refundCharge] CHARGE RECONCILIATION NEEDED: the action_failed marker could not be written on charge ${input.chargeId} (${markerWrite.message}); recording the owed refund before sending it.`,
    );
    await recordX402Reconciliation({ kind: "refund_failed", txHash: null, ...reconciliationBase });
  }

  const refundResult = await refundPayment({
    payerAddress: input.payerAddress,
    amountUsdc: input.amountUsdc,
    network: input.network,
    reason: input.reason,
    idempotencyKey: input.chargeId,
  });

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
      return { refundInitiated: true, refundConfirmed: true, refundTxHash: refundResult.refundTxHash };
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
      return { refundInitiated: true, refundConfirmed: false, refundTxHash: refundResult.refundTxHash };
    }

    case "send_unknown": {
      const watchAdvice = refundResult.refundTxHash
        ? `the reconciliation sweep records refund tx ${refundResult.refundTxHash} if it lands`
        : `check the sender wallet's outgoing transfers to ${input.payerAddress} before refunding by hand`;
      console.error(
        `[refundCharge] REFUND SEND OUTCOME UNKNOWN for charge ${input.chargeId} (settle tx ${input.settleTxHash}): ${refundResult.message}. The refund may have gone out: ${watchAdvice}.`,
      );
      await recordX402Reconciliation({
        kind: "refund_failed",
        txHash: refundResult.refundTxHash,
        ...reconciliationBase,
      });
      return REFUND_NOT_SENT;
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
      return REFUND_NOT_SENT;
    }

    default: {
      const unhandledResult: never = refundResult;
      console.error(`[refundCharge] Unhandled refund result: ${JSON.stringify(unhandledResult)}`);
      return REFUND_NOT_SENT;
    }
  }
}

async function writeActionFailedMarker(params: {
  chargeId: string;
  errorMessage: string;
}): Promise<ChargeTransitionResult> {
  const firstAttempt = await markChargeActionFailed(params);
  if (firstAttempt.success || firstAttempt.reason !== "db_error") return firstAttempt;
  return markChargeActionFailed(params);
}
