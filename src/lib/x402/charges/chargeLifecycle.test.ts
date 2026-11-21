import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

import type { RefundPaymentResult } from "@/lib/x402/facilitator";
import type { NetworkConfig } from "@/lib/x402/networks";

mock.module("server-only", () => ({}));

type IssuedStatement = { sql: string; params: unknown[] };
type SqlProducer = { toSQL: () => IssuedStatement };
type ChargeRow = {
  id: string;
  status: "pending" | "settled" | "failed" | "refunded";
  action: string;
  tx_hash: string | null;
  error_message: string | null;
  payer_address: string;
  metadata: Record<string, unknown>;
  created_at: string;
  has_refund_reconciliation: boolean;
};

const CHARGE_ID = "6f1f6a43-2b3c-4d5e-8f90-0a1b2c3d4e5f";
const PAYER_ADDRESS = "0x00000000000000000000000000000000000000aa";

let issuedStatements: IssuedStatement[] = [];
let storedCharge: ChargeRow | null = null;
let refundResult: RefundPaymentResult = { status: "failed", refundTxHash: null, message: "rpc down" };
let recordedReconciliations: Array<{ kind: string; txHash: string | null }> = [];
let failingUpdateCount = 0;
let isChargeSettled = true;
let refundSendCount = 0;

function answerStatement(statement: IssuedStatement): unknown[] {
  if (statement.sql.startsWith("update")) return isChargeSettled ? [{ id: CHARGE_ID }] : [];
  if (statement.sql.startsWith("select")) return storedCharge ? [storedCharge] : [];
  return [];
}

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: SqlProducer) => {
    const statement = query.toSQL();
    issuedStatements.push(statement);
    if (statement.sql.startsWith("update") && failingUpdateCount > 0) {
      failingUpdateCount -= 1;
      return { data: null, error: { message: "connection reset", code: "08006" } };
    }
    return { data: answerStatement(statement), error: null };
  },
}));

mock.module("@/lib/x402/facilitator", () => ({
  refundPayment: async () => {
    refundSendCount += 1;
    return refundResult;
  },
  settlePayment: async () => ({ ok: false, error: { kind: "timeout", message: "unused", transaction: null } }),
}));

mock.module("@/lib/x402/charges/recordReconciliation", () => ({
  recordX402Reconciliation: async (entry: { kind: string; txHash?: string | null }) => {
    recordedReconciliations.push({ kind: entry.kind, txHash: entry.txHash ?? null });
  },
}));

mock.module("@/lib/x402/charges/insertPendingX402Charge", () => ({
  insertPendingX402Charge: async () => ({
    success: false,
    message: "nonce already used",
    conflictReason: "nonce_used",
  }),
}));

const { refundCharge, settleCharge, updateChargeRecord } = await import("./chargeLifecycle");
const { getNetworkConfig } = await import("@/lib/x402/networks");

function requireNetwork(networkName: string): NetworkConfig {
  const network = getNetworkConfig(networkName);
  if (!network) throw new Error(`[requireNetwork] ${networkName} is missing from the network registry`);
  return network;
}

const baseNetwork = requireNetwork("base");

function readUpdates(): IssuedStatement[] {
  return issuedStatements.filter((statement) => statement.sql.startsWith("update"));
}

function refundAfterFailedAction() {
  return refundCharge({
    chargeId: CHARGE_ID,
    settleTxHash: "0xsettle",
    payerAddress: PAYER_ADDRESS,
    amountUsdc: 0.01,
    network: baseNetwork,
    reason: "Could not dispatch the post.",
    principalId: "principal-1",
  });
}

function replayStoredPayment() {
  return settleCharge({
    paymentHeader: "header",
    network: baseNetwork,
    verified: {
      payerAddress: PAYER_ADDRESS,
      nonce: "0xnonce",
      chargeAmountUsdc: 0.01,
      requirements: {
        scheme: "exact",
        network: baseNetwork.caipNetwork,
        asset: baseNetwork.usdcAddress,
        amount: "10000",
        payTo: "0x0000000000000000000000000000000000000001",
        maxTimeoutSeconds: 60,
        extra: {},
      },
    },
    principal: {
      kind: "wallet",
      principalId: "principal-1",
      address: PAYER_ADDRESS,
      chain: "base",
      sanctionsStatus: "clean",
    },
    action: "list_connections",
    amountUsdc: 0.01,
    requestId: "request-1",
    recipientAddress: "0x0000000000000000000000000000000000000001",
  });
}

beforeEach(() => {
  issuedStatements = [];
  recordedReconciliations = [];
  storedCharge = null;
  failingUpdateCount = 0;
  isChargeSettled = true;
  refundSendCount = 0;
});

describe("refundCharge after the paid action failed", () => {
  test("a refund that cannot be sent keeps the charge settled with the failure on it and leaves a reconciliation row with no tx hash", async () => {
    refundResult = { status: "failed", refundTxHash: null, message: "rpc down" };

    const outcome = await refundAfterFailedAction();

    expect(outcome).toEqual({ refundInitiated: false, refundTxHash: null });
    const updates = readUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0]?.sql).toBe(
      'update "x402_charges" set "error_message" = $1 where ("x402_charges"."id" = $2 and "x402_charges"."status" = $3) returning "id"',
    );
    expect(updates[0]?.params).toEqual(["action_failed: Could not dispatch the post.", CHARGE_ID, "settled"]);
    expect(recordedReconciliations).toEqual([{ kind: "refund_failed", txHash: null }]);
  });

  test("a refund send that timed out leaves the charge settled and a reconciliation row with no tx hash", async () => {
    refundResult = {
      status: "send_unknown",
      refundTxHash: null,
      message: "CDP refund send on Base did not answer within 15000 ms.",
    };

    const outcome = await refundAfterFailedAction();

    expect(outcome).toEqual({ refundInitiated: false, refundTxHash: null });
    expect(readUpdates()).toHaveLength(1);
    expect(recordedReconciliations).toEqual([{ kind: "refund_failed", txHash: null }]);
  });

  test("a refund signed but with an unknown delivery keeps its hash on the reconciliation row for the sweep to check", async () => {
    refundResult = {
      status: "send_unknown",
      refundTxHash: "0xsignedrefund",
      message: "All 3 sends failed in transport.",
    };

    const outcome = await refundAfterFailedAction();

    expect(outcome).toEqual({ refundInitiated: false, refundTxHash: null });
    expect(recordedReconciliations).toEqual([{ kind: "refund_failed", txHash: "0xsignedrefund" }]);
  });

  test("a confirmed refund records the failure first, then moves the charge from settled to refunded", async () => {
    refundResult = { status: "confirmed", refundTxHash: "0xrefund", refundedAt: "2026-11-21T00:00:00.000Z" };

    const outcome = await refundAfterFailedAction();

    expect(outcome).toEqual({ refundInitiated: true, refundTxHash: "0xrefund" });
    const updates = readUpdates();
    expect(updates.map((update) => update.params.at(-1))).toEqual(["settled", "settled"]);
    expect(updates[1]?.sql).toContain('set "status" = $1');
    expect(updates[1]?.params[0]).toBe("refunded");
    expect(recordedReconciliations).toEqual([]);
  });
});

describe("refundCharge when the failure cannot be written on the charge", () => {
  test("a marker write that fails once is retried, and the refund goes out with no extra reconciliation row", async () => {
    failingUpdateCount = 1;
    refundResult = { status: "confirmed", refundTxHash: "0xrefund", refundedAt: "2026-11-21T00:00:00.000Z" };

    const outcome = await refundAfterFailedAction();

    expect(outcome).toEqual({ refundInitiated: true, refundTxHash: "0xrefund" });
    expect(readUpdates().map((update) => update.params[0])).toEqual([
      "action_failed: Could not dispatch the post.",
      "action_failed: Could not dispatch the post.",
      "refunded",
    ]);
    expect(refundSendCount).toBe(1);
    expect(recordedReconciliations).toEqual([]);
  });

  test("a marker write that fails twice records the owed refund before sending it", async () => {
    failingUpdateCount = 2;
    refundResult = { status: "failed", refundTxHash: null, message: "rpc down" };

    const outcome = await refundAfterFailedAction();

    expect(outcome).toEqual({ refundInitiated: false, refundTxHash: null });
    expect(refundSendCount).toBe(1);
    expect(recordedReconciliations).toEqual([
      { kind: "refund_failed", txHash: null },
      { kind: "refund_failed", txHash: null },
    ]);
  });

  test("a charge that is no longer settled gets no refund, only a reconciliation row", async () => {
    isChargeSettled = false;

    const outcome = await refundAfterFailedAction();

    expect(outcome).toEqual({ refundInitiated: false, refundTxHash: null });
    expect(readUpdates()).toHaveLength(1);
    expect(refundSendCount).toBe(0);
    expect(recordedReconciliations).toEqual([{ kind: "refund_failed", txHash: null }]);
  });
});

describe("a replayed payment", () => {
  const settledCharge: ChargeRow = {
    id: CHARGE_ID,
    status: "settled",
    action: "list_connections",
    tx_hash: "0xsettle",
    error_message: null,
    payer_address: PAYER_ADDRESS,
    metadata: {},
    created_at: "2026-11-21T00:00:00.000Z",
    has_refund_reconciliation: false,
  };

  test("is served again when its settled charge's action succeeded", async () => {
    storedCharge = settledCharge;

    const result = await replayStoredPayment();

    expect(result).toMatchObject({ ok: false, reason: "replay", replay: { state: "settled" } });
  });

  test("is refused when its settled charge records a failed action", async () => {
    storedCharge = { ...settledCharge, error_message: "action_failed: Could not dispatch the post." };

    const result = await replayStoredPayment();

    expect(result).toEqual({ ok: false, reason: "replay", replay: { state: "closed", chargeId: CHARGE_ID } });
  });

  test("is refused when its settled charge has a refund reconciliation row but no failure marker", async () => {
    storedCharge = { ...settledCharge, has_refund_reconciliation: true };

    const result = await replayStoredPayment();

    expect(result).toEqual({ ok: false, reason: "replay", replay: { state: "closed", chargeId: CHARGE_ID } });
  });
});

describe("updateChargeRecord", () => {
  const countUpdates = () => issuedStatements.filter((statement) => statement.sql.startsWith("update")).length;

  test("a write that fails once is retried and reported as saved", async () => {
    failingUpdateCount = 1;

    const recordWrite = await updateChargeRecord(CHARGE_ID, { scheduledPostId: CHARGE_ID });

    expect(recordWrite).toEqual({ ok: true });
    expect(countUpdates()).toBe(2);
  });

  test("a write that fails twice returns the database message instead of only logging it", async () => {
    failingUpdateCount = 2;

    const recordWrite = await updateChargeRecord(CHARGE_ID, { metadata: { batch_id: "batch-1" } });

    expect(recordWrite).toEqual({ ok: false, message: "connection reset" });
    expect(countUpdates()).toBe(2);
  });

  test("no fields means no write", async () => {
    expect(await updateChargeRecord(CHARGE_ID, {})).toEqual({ ok: true });
    expect(countUpdates()).toBe(0);
  });
});
