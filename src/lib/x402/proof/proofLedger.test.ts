import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

mock.module("server-only", () => ({}));

type IssuedStatement = { sql: string; params: unknown[] };
type SqlProducer = { toSQL: () => IssuedStatement };
type ChargeRow = {
  id: string;
  network: string;
  action: string;
  amount_usdc: number;
  status: "pending" | "settled" | "failed" | "refunded";
  tx_hash: string | null;
  error_message: string | null;
  payer_address: string;
  settled_at: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
  scheduled_post_id: string | null;
};

let rowsByTable = new Map<string, unknown[]>();
let issuedStatements: IssuedStatement[] = [];

function readQueriedTable(statement: IssuedStatement): string {
  const fromMatch = /from "([a-z_0-9]+)"/.exec(statement.sql);
  return fromMatch?.[1] ?? "unknown";
}

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: SqlProducer) => {
    const statement = query.toSQL();
    issuedStatements.push(statement);
    return { data: rowsByTable.get(readQueriedTable(statement)) ?? [], error: null };
  },
}));

const { loadProofLedger } = await import("./proofLedger");

function buildPostNowCharge(overrides: Partial<ChargeRow>): ChargeRow {
  return {
    id: "6f1f6a43-2b3c-4d5e-8f90-0a1b2c3d4e5f",
    network: "base",
    action: "post.text",
    amount_usdc: 0.5,
    status: "settled",
    tx_hash: "0xsettle",
    error_message: null,
    payer_address: "0x00000000000000000000000000000000000000aa",
    settled_at: "2026-11-21T00:00:00.000Z",
    created_at: "2026-11-21T00:00:00.000Z",
    metadata: { batch_id: "batch-1" },
    scheduled_post_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  rowsByTable = new Map();
  issuedStatements = [];
});

describe("loadProofLedger outcomes", () => {
  test("a post-now whose worker failed shows as failed, with the platform from its direct-post row", async () => {
    rowsByTable.set("x402_charges", [buildPostNowCharge({})]);
    rowsByTable.set("pending_direct_posts", [{ batch_id: "batch-1", platform: "linkedin" }]);

    const ledger = await loadProofLedger();

    expect(ledger).toMatchObject({ ok: true, entries: [{ outcome: "failed", platform: "linkedin" }] });
    const directPostRead = issuedStatements.find((statement) => readQueriedTable(statement) === "pending_direct_posts");
    expect(directPostRead?.params).toContain("failed");
  });

  test("a post-now that published shows as published even if an earlier attempt failed", async () => {
    rowsByTable.set("x402_charges", [buildPostNowCharge({})]);
    rowsByTable.set("content_history", [{ batch_id: "batch-1", platform: "linkedin" }]);
    rowsByTable.set("pending_direct_posts", [{ batch_id: "batch-1", platform: "linkedin" }]);

    const ledger = await loadProofLedger();

    expect(ledger).toMatchObject({ ok: true, entries: [{ outcome: "published" }] });
  });

  test("a settled charge whose paid action failed shows as failed", async () => {
    rowsByTable.set("x402_charges", [
      buildPostNowCharge({ action: "list_connections", metadata: {}, error_message: "action_failed: query failed" }),
    ]);

    const ledger = await loadProofLedger();

    expect(ledger).toMatchObject({ ok: true, entries: [{ outcome: "failed", platform: null }] });
  });
});

describe("loadProofLedger for a post-now whose charge record write was lost", () => {
  const LOST_RECORD_CHARGE_ID = "9b8a7c6d-0000-4000-8000-000000000001";

  test("its post shows through the dispatch rows stored under the charge id", async () => {
    rowsByTable.set("x402_charges", [buildPostNowCharge({ id: LOST_RECORD_CHARGE_ID, metadata: {} })]);
    rowsByTable.set("content_history", [{ batch_id: LOST_RECORD_CHARGE_ID, platform: "linkedin" }]);

    const ledger = await loadProofLedger();

    expect(ledger).toMatchObject({ ok: true, entries: [{ outcome: "published", platform: "linkedin" }] });
    const historyRead = issuedStatements.find((statement) => readQueriedTable(statement) === "content_history");
    expect(historyRead?.params).toContain(LOST_RECORD_CHARGE_ID);
  });

  test("its failed post shows as failed", async () => {
    rowsByTable.set("x402_charges", [buildPostNowCharge({ id: LOST_RECORD_CHARGE_ID, metadata: {} })]);
    rowsByTable.set("pending_direct_posts", [{ batch_id: LOST_RECORD_CHARGE_ID, platform: "x" }]);

    const ledger = await loadProofLedger();

    expect(ledger).toMatchObject({ ok: true, entries: [{ outcome: "failed", platform: "x" }] });
  });

  test("a post charge with no link and no row under its id stays unlinked", async () => {
    rowsByTable.set("x402_charges", [buildPostNowCharge({ id: LOST_RECORD_CHARGE_ID, metadata: {} })]);

    const ledger = await loadProofLedger();

    expect(ledger).toMatchObject({ ok: true, entries: [{ outcome: "unlinked", platform: null }] });
  });
});
