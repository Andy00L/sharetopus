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
  const insertInvoice = db.insert(stripe_invoices).values(toInvoiceRow(payment));
  const { error } = await runQuery(
    payment.outcome === "succeeded"
      ? insertInvoice.onConflictDoUpdate({
          target: stripe_invoices.stripe_invoice_id,
          set: {
            status: "succeeded",
            amount_paid_cents: sql`excluded.amount_paid_cents`,
            currency: sql`excluded.currency`,
          },
          setWhere: eq(stripe_invoices.status, "failed"),
        })
      : insertInvoice.onConflictDoNothing({
          target: stripe_invoices.stripe_invoice_id,
        }),
  );

  if (error) {
    console.error(
      `[recordInvoicePayment] Failed to record ${payment.outcome} for invoice ${payment.stripeInvoiceId}:`,
      error.message,
    );
    return { ok: false };
  }
  return { ok: true };
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
