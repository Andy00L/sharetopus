import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

mock.module("server-only", () => ({}));

type IssuedStatement = { sql: string; params: unknown[] };
type SqlProducer = { toSQL: () => IssuedStatement };
type ChargeRow = {
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
