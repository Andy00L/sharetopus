import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

mock.module("server-only", () => ({}));

type IssuedStatement = { sql: string; params: unknown[] };
type ReconciliationRow = { kind: string; charge_id: string | null; tx_hash: string | null; network: string | null };
type ChargeRow = { id: string; network: string; tx_hash: string | null; principal_id: string };
type DispatchRow = { batch_id: string; principal_id: string; status: "processing" | "completed" | "failed" };
type StepRunner = { run: <Result>(stepName: string, runStep: () => Promise<Result>) => Promise<Result> };
type SweepHandler = (context: { step: StepRunner }) => Promise<unknown>;

const PAYMENT_LATER_CHARGED = "5h6xBEauJ3PK6SWCZ1PGjBvj8vDdWG3KpwATGy1ARAXFSDwt8GFXM7W5Ncn16wmqokgpiKRLuS83KUxyZyv2sUYv";
const PAYMENT_NEVER_CHARGED = "3vQB7B6MrGQZaxCuFg4oh3B5MxB3SXc6vZ4GnFxmBXfKkRnaiJsQ6ArzEXq9g2LcHPLvYXZqbt5yWMSNVYrF6tUW";

let reconciliationRows: ReconciliationRow[] = [];
let chargeNonces = new Set<string>();
let settledChargesWithoutOutcome: ChargeRow[] = [];
let dispatchRows: DispatchRow[] = [];
let capturedHandler: SweepHandler | null = null;

function answerStatement(statement: IssuedStatement): unknown[] {
  if (statement.sql.startsWith('select "kind"')) return reconciliationRows;
  if (statement.sql.startsWith('select "id", "network", "tx_hash"')) {
    return statement.sql.includes("'result'") ? settledChargesWithoutOutcome : [];
  }
  if (statement.sql.includes('from "pending_direct_posts"')) {
    return dispatchRows.filter((dispatchRow) => statement.params.includes(dispatchRow.batch_id));
  }
  if (statement.sql.startsWith('select "nonce"')) {
    return statement.params
      .filter((param): param is string => typeof param === "string" && chargeNonces.has(param))
      .map((nonce) => ({ nonce }));
  }
  return [];
}

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: { toSQL: () => IssuedStatement }) => ({ data: answerStatement(query.toSQL()), error: null }),
}));

mock.module("@/inngest/client", () => ({
  inngest: {
    createFunction: (_config: unknown, handler: SweepHandler) => {
      capturedHandler = handler;
      return {};
    },
  },
}));

await import("./sweepX402ReconciliationCron");

function runSweep(): Promise<unknown> {
  if (!capturedHandler) throw new Error("[runSweep] the sweep handler was not registered");
  return capturedHandler({ step: { run: (_stepName, runStep) => runStep() } });
}

function buildUnchargedPaymentRow(txHash: string): ReconciliationRow {
  return { kind: "settle_unrecorded", charge_id: null, tx_hash: txHash, network: "solana" };
}

beforeEach(() => {
  reconciliationRows = [];
  chargeNonces = new Set();
  settledChargesWithoutOutcome = [];
  dispatchRows = [];
});

async function readSweepFailure(): Promise<string> {
  return runSweep().then(
    () => "",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

describe("sweepX402ReconciliationCron on payments recorded with no charge", () => {
  test("a row whose payment a charge holds now is resolved", async () => {
    reconciliationRows = [buildUnchargedPaymentRow(PAYMENT_LATER_CHARGED)];
    chargeNonces = new Set([PAYMENT_LATER_CHARGED]);

    expect(await runSweep()).toMatchObject({ reconciliationRows: 1, resolved: 1, open: [] });
  });

  test("a row whose payment no charge holds stays open", async () => {
    reconciliationRows = [
      buildUnchargedPaymentRow(PAYMENT_LATER_CHARGED),
      buildUnchargedPaymentRow(PAYMENT_NEVER_CHARGED),
    ];
    chargeNonces = new Set([PAYMENT_LATER_CHARGED]);

    const sweepFailure = await readSweepFailure();

    expect(sweepFailure).toContain("1 open x402 money item(s)");
    expect(sweepFailure).toContain(PAYMENT_NEVER_CHARGED);
    expect(sweepFailure).not.toContain(PAYMENT_LATER_CHARGED);
  });
});

describe("sweepX402ReconciliationCron on a paid post whose request died after settlement", () => {
  test("a settled post charge with no result, no post link, no marker and no refund is shown to a person", async () => {
    settledChargesWithoutOutcome = [
      { id: "charge-killed", network: "base", tx_hash: "0xsettle", principal_id: "wallet-1" },
    ];

    const sweepFailure = await readSweepFailure();

    expect(sweepFailure).toContain("1 open x402 money item(s)");
    expect(sweepFailure).toContain('"kind":"action_outcome_unknown"');
    expect(sweepFailure).toContain("charge-killed");
  });

  test("a post-now charge whose record write was lost but whose dispatch row carries its id is reported with the dispatch status, not opened", async () => {
    const chargeId = "4c1d2e3f-0000-4000-8000-000000000001";
    settledChargesWithoutOutcome = [{ id: chargeId, network: "arc", tx_hash: "0xsettle", principal_id: "wallet-1" }];
    dispatchRows = [{ batch_id: chargeId, principal_id: "wallet-1", status: "completed" }];

    expect(await runSweep()).toMatchObject({
      settledWithoutOutcome: 1,
      lostRecordsWithDispatch: [
        { kind: "record_lost_post_dispatched", chargeId, network: "arc", dispatchStatus: "completed" },
      ],
      open: [],
    });
  });

  test("a dispatch row of another principal under the same id does not clear the charge", async () => {
    const chargeId = "4c1d2e3f-0000-4000-8000-000000000002";
    settledChargesWithoutOutcome = [{ id: chargeId, network: "arc", tx_hash: "0xsettle", principal_id: "wallet-1" }];
    dispatchRows = [{ batch_id: chargeId, principal_id: "wallet-2", status: "completed" }];

    expect(await readSweepFailure()).toContain('"kind":"action_outcome_unknown"');
  });
});
