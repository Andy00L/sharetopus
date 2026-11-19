import "server-only";

import { eq, sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { stripe_invoices } from "@/db/schema";

export type InvoicePaymentOutcome = "succeeded" | "failed";

export type InvoicePayment = {
  userId: string;
  stripeInvoiceId: string;
  outcome: InvoicePaymentOutcome;
  amountPaidCents: number;
  currency: string;
};

/**
 * Stripe can deliver a failed attempt after the payment that settled the
 * invoice, so a failure never replaces a success.
 */
export async function recordInvoicePayment(
  payment: InvoicePayment,
): Promise<{ ok: boolean }> {
  return recordInvoicePayments([payment]);
}

export async function recordInvoicePayments(
  payments: InvoicePayment[],
): Promise<{ ok: boolean }> {
  const succeededRows = payments
    .filter((payment) => payment.outcome === "succeeded")
    .map(toInvoiceRow);
  const failedRows = payments
    .filter((payment) => payment.outcome === "failed")
    .map(toInvoiceRow);

  let isRecorded = true;

  if (succeededRows.length > 0) {
    const { error } = await runQuery(
      db
        .insert(stripe_invoices)
        .values(succeededRows)
        .onConflictDoUpdate({
          target: stripe_invoices.stripe_invoice_id,
          set: {
            status: "succeeded",
            amount_paid_cents: sql`excluded.amount_paid_cents`,
            currency: sql`excluded.currency`,
          },
          setWhere: eq(stripe_invoices.status, "failed"),
        }),
    );
    if (error) {
      logRecordFailure("succeeded", succeededRows, error.message);
      isRecorded = false;
    }
  }

  if (failedRows.length > 0) {
    const { error } = await runQuery(
      db
        .insert(stripe_invoices)
        .values(failedRows)
        .onConflictDoNothing({ target: stripe_invoices.stripe_invoice_id }),
    );
    if (error) {
      logRecordFailure("failed", failedRows, error.message);
      isRecorded = false;
    }
  }

  return { ok: isRecorded };
}

function toInvoiceRow(
  payment: InvoicePayment,
): typeof stripe_invoices.$inferInsert {
  return {
    user_id: payment.userId,
    stripe_invoice_id: payment.stripeInvoiceId,
    amount_paid_cents:
      payment.outcome === "succeeded" ? payment.amountPaidCents : null,
    currency: payment.currency,
    status: payment.outcome,
  };
}

function logRecordFailure(
  outcome: InvoicePaymentOutcome,
  rows: (typeof stripe_invoices.$inferInsert)[],
  errorMessage: string,
): void {
  const invoiceIds = rows.map((row) => row.stripe_invoice_id).join(", ");
  console.error(
    `[recordInvoicePayments] Failed to record ${outcome} for invoice(s) ${invoiceIds}:`,
    errorMessage,
  );
}
