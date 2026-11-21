import { describe, expect, test } from "bun:test";

import { decideReconciliationRow } from "./x402ReconciliationDecision";

describe("decideReconciliationRow", () => {
  test("settle rows close once the charge leaves pending", () => {
    for (const kind of ["settle_indeterminate", "settle_unrecorded"] as const) {
      expect(decideReconciliationRow({ row: { kind, tx_hash: null }, chargeStatus: "pending", isRefundRecorded: false }).kind).toBe("open");
      expect(decideReconciliationRow({ row: { kind, tx_hash: null }, chargeStatus: "settled", isRefundRecorded: false }).kind).toBe("resolved");
    }
  });

  test("a failed refund closes when recorded, asks for a chain check with a hash, stays open without one", () => {
    const refundRow = (txHash: string | null) => ({ kind: "refund_failed" as const, tx_hash: txHash });
    expect(decideReconciliationRow({ row: refundRow("0xrefund"), chargeStatus: "settled", isRefundRecorded: true })).toEqual({ kind: "resolved" });
    expect(decideReconciliationRow({ row: refundRow("0xrefund"), chargeStatus: "settled", isRefundRecorded: false })).toEqual({
      kind: "confirm_refund_tx",
      txHash: "0xrefund",
    });
    expect(decideReconciliationRow({ row: refundRow(null), chargeStatus: "settled", isRefundRecorded: false }).kind).toBe("open");
  });
});
