import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

import type { X402AuditEntry } from "./logX402Call";

mock.module("server-only", () => ({}));

type IssuedStatement = { sql: string; params: unknown[] };
type SqlProducer = { toSQL: () => IssuedStatement };

let issuedStatements: IssuedStatement[] = [];

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: SqlProducer) => {
    issuedStatements.push(query.toSQL());
    return { data: [], error: null };
  },
}));

const { logX402Call } = await import("./logX402Call");

const UNPAID_PROBE: X402AuditEntry = {
  principal: null,
  action: "list_connections",
  endpoint: "/api/x402/connections",
  chargeId: null,
  resultStatus: "402_required",
  latencyMs: 12,
  ipHash: "hash",
  userAgent: "8004scan-HealthChecker",
};

beforeEach(() => {
  issuedStatements = [];
});

describe("logX402Call", () => {
  test("an unpaid 402 challenge writes no access-log row", async () => {
    await logX402Call(UNPAID_PROBE);

    expect(issuedStatements).toEqual([]);
  });

  test("a rate-limited request still writes its access-log row", async () => {
    await logX402Call({ ...UNPAID_PROBE, resultStatus: "rate_limited" });

    expect(issuedStatements).toHaveLength(1);
    expect(issuedStatements[0]?.sql).toStartWith('insert into "x402_access_log"');
    expect(issuedStatements[0]?.params).toContain("rate_limited");
  });
});
