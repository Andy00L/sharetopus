import "server-only";

import { eq } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { stripe_invoices } from "@/db/schema";

export type InvoicePaymentOutcome = "succeeded" | "failed";

/**
 * Records how a Stripe invoice's payment went, for the Stripe webhook and
 * the ensureUserExists sync. Stripe can deliver a failed attempt after the
 * payment that settled the invoice, so a failure never replaces a success.
 * A success replaces an earlier failure, the one update the stripe_invoices
 * trigger accepts (drizzle/0002_append_only_detach_and_invoice_payment.sql).
 */
export async function recordInvoicePayment(payment: {
  userId: string;
  stripeInvoiceId: string;
  outcome: InvoicePaymentOutcome;
  amountPaidCents: number;
  currency: string;
}): Promise<{ ok: boolean }> {
  const amountPaidCents =
    payment.outcome === "succeeded" ? payment.amountPaidCents : null;
  const insertInvoice = db.insert(stripe_invoices).values({
    user_id: payment.userId,
    stripe_invoice_id: payment.stripeInvoiceId,
    amount_paid_cents: amountPaidCents,
    currency: payment.currency,
    status: payment.outcome,
  });

  const { error } = await runQuery(
    payment.outcome === "succeeded"
      ? insertInvoice.onConflictDoUpdate({
          target: stripe_invoices.stripe_invoice_id,
          set: {
            status: "succeeded",
            amount_paid_cents: amountPaidCents,
            currency: payment.currency,
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
