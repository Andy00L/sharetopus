import type { x402_charges, x402_reconciliation } from "@/db/schema";

type ReconciliationRow = Pick<typeof x402_reconciliation.$inferSelect, "kind" | "tx_hash">;
type ChargeStatus = (typeof x402_charges.$inferSelect)["status"];

export type ReconciliationDecision =
  | { kind: "resolved" }
  | { kind: "open"; note: string }
  | { kind: "confirm_refund_tx"; txHash: string };

export function decideReconciliationRow(input: {
  row: ReconciliationRow;
  chargeStatus: ChargeStatus;
  isRefundRecorded: boolean;
}): ReconciliationDecision {
  const { row, chargeStatus, isRefundRecorded } = input;
  switch (row.kind) {
    case "settle_indeterminate":
    case "settle_unrecorded":
      return chargeStatus === "pending"
        ? {
            kind: "open",
            note: "Charge still pending: decide whether the money moved and refund if so.",
          }
        : { kind: "resolved" };
    case "refund_failed":
      if (isRefundRecorded) return { kind: "resolved" };
      if (!row.tx_hash) {
        return {
          kind: "open",
          note: "No refund transaction hash was recorded. Check the sender wallet's outgoing transfers to the payer before refunding by hand.",
        };
      }
      return { kind: "confirm_refund_tx", txHash: row.tx_hash };
    default: {
      const unhandledKind: never = row.kind;
      return { kind: "open", note: `Unknown reconciliation kind "${String(unhandledKind)}".` };
    }
  }
}
