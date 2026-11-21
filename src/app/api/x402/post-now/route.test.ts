import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import * as nextServer from "next/server";

import type { NetworkConfig } from "@/lib/x402/networks";

type IssuedStatement = { sql: string; params: unknown[] };
type ChargeRow = {
  id: string;
  nonce: string;
  status: "pending" | "settled" | "failed" | "refunded";
  action: string;
  tx_hash: string | null;
  error_message: string | null;
  payer_address: string;
  metadata: Record<string, unknown>;
  created_at: string;
  has_refund_reconciliation: boolean;
};
type DispatchRow = {
  event_id: string;
  batch_id: string;
  principal_id: string;
  social_account_id: string;
  platform: string;
  status: "processing" | "completed" | "failed";
  failure_reason: string | null;
  created_at: string;
  idempotency_key: string | null;
};
type HeldWrite = { markArrived: () => void; released: Promise<void> };
type HistoryRow = {
  batch_id: string;
  principal_id: string;
  social_account_id: string;
  platform: string;
  content_id: string;
};

const PRINCIPAL_ID = "wallet-1";
const OTHER_PRINCIPAL_ID = "wallet-2";
const PAYER_ADDRESS = "0x00000000000000000000000000000000000000aa";
const SOCIAL_ACCOUNT_ID = "5b1f0c4e-3d2a-4f6b-8c9d-0e1f2a3b4c5d";
const LEGACY_NONCE = "nonce-legacy";
const LEGACY_CHARGE_ID = "charge-legacy";
const LEGACY_BATCH_ID = "_R3gCjlNUG9KhdbMdt2tMXzCvrkdYPx2";

const store = {
  charges: new Map<string, ChargeRow>(),
  dispatchRows: [] as DispatchRow[],
  historyRows: [] as HistoryRow[],
  failingRecordWrites: 0,
  heldRecordWrite: null as HeldWrite | null,
  isDispatchReadFailing: false,
  settledNonces: [] as string[],
  sentEventIds: [] as string[],
  refundedChargeIds: [] as string[],
};

beforeEach(() => {
  store.charges.clear();
  store.dispatchRows = [];
  store.historyRows = [];
  store.failingRecordWrites = 0;
  store.heldRecordWrite = null;
  store.isDispatchReadFailing = false;
  store.settledNonces = [];
  store.sentEventIds = [];
  store.refundedChargeIds = [];
});

function readStatement(query: unknown): IssuedStatement {
  if (typeof query !== "object" || query === null || !("toSQL" in query)) {
    throw new Error("runQuery fake expects a drizzle query");
  }
  const toSql = query.toSQL;
  if (typeof toSql !== "function") throw new Error("runQuery fake expects toSQL()");
  const statement: unknown = toSql.call(query);
  if (
    typeof statement !== "object" ||
    statement === null ||
    !("sql" in statement) ||
    !("params" in statement) ||
    typeof statement.sql !== "string" ||
    !Array.isArray(statement.params)
  ) {
    throw new Error("toSQL() returned an unexpected shape");
  }
  return { sql: statement.sql, params: statement.params };
}

function readInsertedRows(statement: IssuedStatement): Record<string, unknown>[] {
  const columnList = /^insert into "[a-z_]+" \(([^)]*)\)/.exec(statement.sql)?.[1] ?? "";
  const columns = columnList.split(", ").map((column) => column.replaceAll('"', ""));
  const valuesSql = statement.sql.slice(statement.sql.indexOf(" values "));
  return [...valuesSql.matchAll(/\(([^()]*)\)/g)].map((tupleMatch) => {
    const tokens = (tupleMatch[1] ?? "").split(", ");
    const insertedRow: Record<string, unknown> = {};
    tokens.forEach((token, columnIndex) => {
      const column = columns[columnIndex];
      const placeholder = /^\$(\d+)$/.exec(token);
      if (column && placeholder) insertedRow[column] = statement.params[Number(placeholder[1]) - 1];
    });
    return insertedRow;
  });
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function insertDispatchRows(statement: IssuedStatement): { event_id: string }[] {
  const insertedEventIds: { event_id: string }[] = [];
  for (const insertedRow of readInsertedRows(statement)) {
    const dispatchRow: DispatchRow = {
      event_id: String(insertedRow.event_id),
      batch_id: String(insertedRow.batch_id),
      principal_id: String(insertedRow.principal_id),
      social_account_id: String(insertedRow.social_account_id),
      platform: String(insertedRow.platform),
      status: "processing",
      failure_reason: null,
      created_at: new Date().toISOString(),
      idempotency_key: toNullableString(insertedRow.idempotency_key),
    };
    const hasKeyConflict = store.dispatchRows.some(
      (existingRow) =>
        dispatchRow.idempotency_key !== null &&
        existingRow.principal_id === dispatchRow.principal_id &&
        existingRow.idempotency_key === dispatchRow.idempotency_key,
    );
    if (hasKeyConflict) continue;
    store.dispatchRows.push(dispatchRow);
    insertedEventIds.push({ event_id: dispatchRow.event_id });
  }
  return insertedEventIds;
}

function selectDispatchRows(statement: IssuedStatement): DispatchRow[] {
  const whereSql = statement.sql.slice(statement.sql.indexOf(" where "));
  const [firstParam, secondParam] = statement.params;
  if (whereSql.includes('"batch_id" = ')) {
    return store.dispatchRows.filter(
      (dispatchRow) => dispatchRow.batch_id === firstParam && dispatchRow.principal_id === secondParam,
    );
  }
  return store.dispatchRows.filter(
    (dispatchRow) => dispatchRow.principal_id === firstParam && dispatchRow.idempotency_key === secondParam,
  );
}

function updateChargeMetadata(statement: IssuedStatement): { id: string }[] {
  const [metadataParam, chargeIdParam] = statement.params;
  const charge = [...store.charges.values()].find((storedCharge) => storedCharge.id === chargeIdParam);
  if (!charge || typeof metadataParam !== "string") return [];
  const parsedMetadata: unknown = JSON.parse(metadataParam);
  if (typeof parsedMetadata === "object" && parsedMetadata !== null) {
    charge.metadata = { ...parsedMetadata };
  }
  return [{ id: charge.id }];
}

function answerStatement(statement: IssuedStatement): { data: unknown[] | null; error: { message: string } | null } {
  const { sql, params } = statement;
  if (sql.startsWith('select "id", "platform" from "social_accounts"')) {
    return { data: [{ id: SOCIAL_ACCOUNT_ID, platform: "linkedin" }], error: null };
  }
  if (sql.startsWith('insert into "pending_direct_posts"')) {
    return { data: insertDispatchRows(statement), error: null };
  }
  if (sql.startsWith("select") && sql.includes('from "pending_direct_posts"')) {
    if (store.isDispatchReadFailing) return { data: null, error: { message: "connection reset" } };
    return { data: selectDispatchRows(statement), error: null };
  }
  if (sql.startsWith("select") && sql.includes('from "content_history"')) {
    const [batchIdParam, principalIdParam] = params;
    return {
      data: store.historyRows.filter(
        (historyRow) => historyRow.batch_id === batchIdParam && historyRow.principal_id === principalIdParam,
      ),
      error: null,
    };
  }
  if (sql.startsWith("select") && sql.includes('from "x402_charges"')) {
    const charge = params
      .map((param) => (typeof param === "string" ? store.charges.get(param) : undefined))
      .find((storedCharge) => storedCharge !== undefined);
    return { data: charge ? [charge] : [], error: null };
  }
  if (sql.startsWith('update "x402_charges" set "metadata"')) {
    if (store.failingRecordWrites > 0) {
      store.failingRecordWrites -= 1;
      return { data: null, error: { message: "connection reset" } };
    }
    return { data: updateChargeMetadata(statement), error: null };
  }
  throw new Error(`Unexpected statement: ${sql}`);
}

let baseNetwork: NetworkConfig | null = null;

mock.module("server-only", () => ({}));
mock.module("next/server", () => ({ ...nextServer, after: () => undefined }));
function holdRecordWrite(): { arrived: Promise<void>; release: () => void } {
  let markArrived: () => void = () => undefined;
  let release: () => void = () => undefined;
  const arrived = new Promise<void>((resolve) => {
    markArrived = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  store.heldRecordWrite = { markArrived, released };
  return { arrived, release };
}

async function runFakeQuery(query: unknown): Promise<ReturnType<typeof answerStatement>> {
  const statement = readStatement(query);
  const heldWrite = store.heldRecordWrite;
  if (heldWrite && statement.sql.startsWith('update "x402_charges" set "metadata"')) {
    store.heldRecordWrite = null;
    heldWrite.markArrived();
    await heldWrite.released;
  }
  return answerStatement(statement);
}

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: runFakeQuery,
}));
mock.module("@/actions/server/rateLimit/checkRateLimit", () => ({
  checkRateLimit: async () => ({ success: true }),
}));
mock.module("@/actions/server/data/getServerSignedViewUrl", () => ({
  getServerSignedViewUrl: async () => ({ success: true, url: "https://storage.test/unused" }),
  getServerSignedViewUrls: async () => ({ success: true, urlByPath: new Map() }),
}));
mock.module("@/actions/api/upstash", () => ({
  redis: {
    set: async () => "OK",
    del: async () => 1,
  },
}));
mock.module("@/inngest/client", () => ({
  inngest: {
    send: async (payloads: { id: string }[]) => {
      store.sentEventIds.push(...payloads.map((payload) => payload.id));
      return { ids: payloads.map((payload) => payload.id) };
    },
  },
}));
mock.module("@/lib/api/context", () => ({
  extractIpHash: async () => "ip-hash",
  extractUserAgent: async () => "agent",
}));
mock.module("@/lib/x402/audit/logX402Call", () => ({ logX402Call: async () => undefined }));
mock.module("@/lib/x402/auth/resolveOrOnboardWalletPrincipal", () => ({
  resolveOrOnboardWalletPrincipal: async () => ({ ok: true, principal: { principalId: PRINCIPAL_ID } }),
}));
mock.module("@/lib/x402/pricing/readActionPrice", () => ({
  readActionPrice: async () => ({ ok: true, usdcPrice: 0.05 }),
}));
mock.module("@/lib/x402/http/resolveRequestNetwork", () => ({
  resolveRequestNetwork: () => ({ ok: true, network: baseNetwork, recipientAddress: "0xrecipient" }),
}));
mock.module("@/lib/x402/facilitator", () => ({
  verifyPayment: async (input: { paymentHeader: string }) => ({
    ok: true,
    payerAddress: PAYER_ADDRESS,
    nonce: input.paymentHeader,
    chargeAmountUsdc: 0.05,
    requirements: { amount: "50000" },
  }),
  settlePayment: async () => ({ ok: true, txHash: "0xsettle", settledAt: new Date().toISOString() }),
  refundPayment: async () => {
    throw new Error("no refund is expected");
  },
}));
mock.module("@/lib/x402/charges/insertPendingX402Charge", () => ({
  insertPendingX402Charge: async (params: { nonce: string; action: string; payerAddress: string }) => {
    if (store.charges.has(params.nonce)) {
      return { success: false, message: "Payment nonce already used.", conflictReason: "nonce_used" };
    }
    const chargeId = `charge-${params.nonce}`;
    store.charges.set(params.nonce, {
      id: chargeId,
      nonce: params.nonce,
      status: "pending",
      action: params.action,
      tx_hash: null,
      error_message: null,
      payer_address: params.payerAddress,
      metadata: {},
      created_at: new Date().toISOString(),
      has_refund_reconciliation: false,
    });
    return { success: true, chargeId };
  },
}));
mock.module("@/lib/x402/charges/chargeTransitions", () => ({
  markChargeSettled: async (params: { chargeId: string; txHash: string }) => {
    const charge = [...store.charges.values()].find((storedCharge) => storedCharge.id === params.chargeId);
    if (!charge) return { success: false, reason: "not_in_expected_status", message: "missing" };
    charge.status = "settled";
    charge.tx_hash = params.txHash;
    store.settledNonces.push(charge.nonce);
    return { success: true };
  },
  markChargeFailed: async () => ({ success: true }),
  markChargeActionFailed: async () => ({ success: true }),
  markChargeRefunded: async (params: { chargeId: string }) => {
    store.refundedChargeIds.push(params.chargeId);
    return { success: true };
  },
}));
mock.module("@/lib/x402/charges/recordReconciliation", () => ({
  recordX402Reconciliation: async () => undefined,
}));

const { getNetworkConfig } = await import("@/lib/x402/networks");
baseNetwork = getNetworkConfig("base") ?? null;
const { POST } = await import("./route");

function callPostNow(nonce: string): Promise<Response> {
  return POST(
    new nextServer.NextRequest("https://sharetopus.test/api/x402/post-now", {
      method: "POST",
      headers: { "payment-signature": nonce, "content-type": "application/json" },
      body: JSON.stringify({
        social_account_id: SOCIAL_ACCOUNT_ID,
        platform: "linkedin",
        post_type: "text",
        description: "Launch day.",
      }),
    }),
  );
}

function seedSettledChargeWithBatchOnly(): void {
  store.charges.set(LEGACY_NONCE, {
    id: LEGACY_CHARGE_ID,
    nonce: LEGACY_NONCE,
    status: "settled",
    action: "post.text",
    tx_hash: "0xlegacy",
    error_message: null,
    payer_address: PAYER_ADDRESS,
    metadata: { batch_id: LEGACY_BATCH_ID },
    created_at: "2026-09-16T23:52:03.795Z",
    has_refund_reconciliation: false,
  });
}

function seedDispatchRow(dispatchRow: Partial<DispatchRow> & Pick<DispatchRow, "status">): void {
  store.dispatchRows.push({
    event_id: "evt-legacy",
    batch_id: LEGACY_BATCH_ID,
    principal_id: PRINCIPAL_ID,
    social_account_id: SOCIAL_ACCOUNT_ID,
    platform: "linkedin",
    failure_reason: null,
    created_at: "2026-09-16T23:52:04.952Z",
    idempotency_key: "key-legacy",
    ...dispatchRow,
  });
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new Error("[toRecord] expected a JSON object");
  return { ...value };
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  return toRecord(await response.json());
}

describe("a replay of a post-now payment whose settled charge has a batch_id but no stored result", () => {
  const DISPATCH_OUTCOMES = [
    {
      outcome: "published",
      seed: () => {
        seedDispatchRow({ status: "completed" });
        store.historyRows.push({
          batch_id: LEGACY_BATCH_ID,
          principal_id: PRINCIPAL_ID,
          social_account_id: SOCIAL_ACCOUNT_ID,
          platform: "linkedin",
          content_id: "urn:li:share:7",
        });
      },
      expectedPost: { eventId: "evt-legacy", status: "published", contentId: "urn:li:share:7" },
    },
    {
      outcome: "failed",
      seed: () => seedDispatchRow({ status: "failed", failure_reason: "LinkedIn token expired" }),
      expectedPost: { eventId: "evt-legacy", status: "failed", failureReason: "LinkedIn token expired" },
    },
    {
      outcome: "still processing",
      seed: () => seedDispatchRow({ status: "processing" }),
      expectedPost: { eventId: "evt-legacy", status: "processing" },
    },
  ];

  for (const dispatchOutcome of DISPATCH_OUTCOMES) {
    test(`answers 200 with the first call's fields and the post ${dispatchOutcome.outcome}, with no new charge or dispatch`, async () => {
      seedSettledChargeWithBatchOnly();
      dispatchOutcome.seed();

      const response = await callPostNow(LEGACY_NONCE);

      expect(response.status).toBe(200);
      expect(await readBody(response)).toMatchObject({
        success: true,
        chargeId: LEGACY_CHARGE_ID,
        txHash: "0xlegacy",
        data: {
          batchId: LEGACY_BATCH_ID,
          eventIds: ["evt-legacy"],
          dispatched: 1,
          posts: [dispatchOutcome.expectedPost],
        },
      });
      expect(store.settledNonces).toEqual([]);
      expect(store.sentEventIds).toEqual([]);
      expect(store.dispatchRows).toHaveLength(1);
    });
  }

  test("answers the existing 409 when the batch has no dispatch row for this payer, and runs nothing", async () => {
    seedSettledChargeWithBatchOnly();
    seedDispatchRow({ status: "completed", principal_id: OTHER_PRINCIPAL_ID });

    const response = await callPostNow(LEGACY_NONCE);

    expect(response.status).toBe(409);
    expect(await readBody(response)).toMatchObject({ error: "replay_detected" });
    expect(store.settledNonces).toEqual([]);
    expect(store.sentEventIds).toEqual([]);
    expect(store.refundedChargeIds).toEqual([]);
  });

  test("answers 503 with Retry-After when the dispatch rows cannot be read, and runs nothing", async () => {
    seedSettledChargeWithBatchOnly();
    seedDispatchRow({ status: "completed" });
    store.isDispatchReadFailing = true;

    const response = await callPostNow(LEGACY_NONCE);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(await readBody(response)).toMatchObject({ error: "replay_lookup_failed" });
    expect(store.settledNonces).toEqual([]);
    expect(store.sentEventIds).toEqual([]);
  });
});

describe("a replay that arrives while the first call is saving its result", () => {
  test("answers the dispatch the first call made, and both calls end with one charge and one post", async () => {
    const recordWrite = holdRecordWrite();
    const firstCall = callPostNow("nonce-1");
    await recordWrite.arrived;

    const replayResponse = await callPostNow("nonce-1");
    recordWrite.release();
    const firstResponse = await firstCall;

    const firstBody = await readBody(firstResponse);
    expect(replayResponse.status).toBe(200);
    expect(firstResponse.status).toBe(200);
    expect(await readBody(replayResponse)).toMatchObject({
      chargeId: firstBody.chargeId,
      data: { ...toRecord(firstBody.data), posts: [{ status: "processing" }] },
    });
    expect(store.settledNonces).toEqual(["nonce-1"]);
    expect(store.sentEventIds).toHaveLength(1);
  });
});

describe("a paid post-now whose charge record write is lost after the dispatch", () => {
  test("a replay of its payment answers the dispatch from the row stored under the charge id", async () => {
    store.failingRecordWrites = 2;

    const firstResponse = await callPostNow("nonce-1");
    const firstBody = await readBody(firstResponse);
    const replayResponse = await callPostNow("nonce-1");
    const replayBody = await readBody(replayResponse);

    expect(firstResponse.status).toBe(200);
    expect(store.charges.get("nonce-1")?.metadata).toEqual({});
    expect(replayResponse.status).toBe(200);
    expect(replayBody.chargeId).toBe(firstBody.chargeId);
    expect(replayBody.data).toEqual({
      ...toRecord(firstBody.data),
      posts: [{ eventId: store.dispatchRows[0]?.event_id, status: "processing" }],
    });
    expect(firstBody.data).toMatchObject({ batchId: firstBody.chargeId, dispatched: 1 });
    expect(store.settledNonces).toEqual(["nonce-1"]);
    expect(store.sentEventIds).toHaveLength(1);
  });
});
