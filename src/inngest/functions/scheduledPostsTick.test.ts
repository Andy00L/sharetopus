import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

type StoredPost = {
  id: string;
  status: string;
  scheduled_at: string;
  updated_at: string;
  principal_id: string;
  social_account_id: string;
  platform: string;
};

type FinalizeCall = { postId: string; failureMessage: string };

type FinalizeResult =
  | { success: true; outcome: { ok: boolean }; updated: boolean }
  | { success: false; message: string };

const HOUR_MS = 60 * 60 * 1000;
const NOW_MS = Date.parse("2026-11-21T12:00:00.000Z");

const world: {
  posts: StoredPost[];
  isReadFailing: boolean;
  failingFinalizeIds: Set<string>;
  finalizeCalls: FinalizeCall[];
  sentEvents: unknown[];
} = {
  posts: [],
  isReadFailing: false,
  failingFinalizeIds: new Set(),
  finalizeCalls: [],
  sentEvents: [],
};

const CONDITION_PATTERN =
  /"scheduled_posts"\."(\w+)" (?:(=|<|<=) \$(\d+)|in \(([^)]*)\))/g;

type Condition = { column: keyof StoredPost; operator: "=" | "<" | "<=" | "in"; values: unknown[] };

function isStoredColumn(column: string): column is keyof StoredPost {
  return ["id", "status", "scheduled_at", "updated_at"].includes(column);
}

function readCondition(conditionMatch: RegExpMatchArray, params: unknown[]): Condition {
  const [, column, operator, paramIndex, inPlaceholders] = conditionMatch;
  if (!isStoredColumn(column)) throw new Error(`Unexpected column ${column}`);
  if (inPlaceholders) {
    const values = inPlaceholders
      .split(", ")
      .map((placeholder) => params[Number(placeholder.replace("$", "")) - 1]);
    return { column, operator: "in", values };
  }
  if (operator !== "=" && operator !== "<" && operator !== "<=") {
    throw new Error(`Unexpected operator ${operator}`);
  }
  return { column, operator, values: [params[Number(paramIndex) - 1]] };
}

function compareStored(column: keyof StoredPost, stored: string, wanted: unknown): number {
  if (typeof wanted !== "string") throw new Error(`Unexpected param for ${column}`);
  const isTime = column === "scheduled_at" || column === "updated_at";
  if (isTime) return Date.parse(stored) - Date.parse(wanted);
  return stored === wanted ? 0 : 1;
}

function matchesCondition(post: StoredPost, condition: Condition): boolean {
  const stored = post[condition.column];
  switch (condition.operator) {
    case "=":
    case "in":
      return condition.values.some((wanted) => compareStored(condition.column, stored, wanted) === 0);
    case "<":
      return compareStored(condition.column, stored, condition.values[0]) < 0;
    case "<=":
      return compareStored(condition.column, stored, condition.values[0]) <= 0;
  }
}

function readStatement(query: unknown): { sql: string; params: unknown[] } {
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

mock.module("server-only", () => ({}));

mock.module("@/inngest/client", () => ({
  inngest: {
    createFunction: (config: unknown, handler: (input: unknown) => Promise<unknown>) => ({
      config,
      handler,
    }),
    send: async () => undefined,
  },
}));

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: unknown) => {
    const { sql, params } = readStatement(query);
    if (!sql.startsWith("select") || !sql.includes('from "scheduled_posts"')) {
      throw new Error(`Unexpected statement: ${sql}`);
    }
    if (world.isReadFailing) {
      return { data: null, error: { message: "connection reset", code: "08006" } };
    }
    const whereSql = sql.split(" where ")[1] ?? "";
    const conditions = [...whereSql.matchAll(CONDITION_PATTERN)].map((conditionMatch) =>
      readCondition(conditionMatch, params),
    );
    const rows = world.posts.filter((post) =>
      conditions.every((condition) => matchesCondition(post, condition)),
    );
    return { data: rows, error: null };
  },
}));

mock.module("./processSinglePostHelpers", () => ({
  finalizeProcessingPost: async (input: {
    post: StoredPost;
    failureMessage: string;
  }): Promise<FinalizeResult> => {
    world.finalizeCalls.push({ postId: input.post.id, failureMessage: input.failureMessage });
    if (world.failingFinalizeIds.has(input.post.id)) {
      return { success: false, message: "mark-failed error: connection reset" };
    }
    return { success: true, outcome: { ok: false }, updated: true };
  },
}));

const { scheduledPostsTick } = await import("./scheduledPostsTick");

type CapturedFunction = { handler: (input: unknown) => Promise<unknown> };

function isCapturedFunction(candidate: unknown): candidate is CapturedFunction {
  return typeof candidate === "object" && candidate !== null && "handler" in candidate;
}

function readCapturedFunction(candidate: unknown): CapturedFunction {
  if (!isCapturedFunction(candidate)) throw new Error("createFunction mock not applied");
  return candidate;
}

const tick = readCapturedFunction(scheduledPostsTick);

const step = {
  run: async (_stepId: string, stepBody: () => Promise<unknown>) => stepBody(),
  sendEvent: async (_stepId: string, events: unknown[]) => {
    world.sentEvents.push(...events);
  },
};

function storePost(changes: Partial<StoredPost> & Pick<StoredPost, "id">): void {
  world.posts.push({
    status: "processing",
    scheduled_at: new Date(NOW_MS - 5 * HOUR_MS).toISOString(),
    updated_at: new Date(NOW_MS - 5 * HOUR_MS).toISOString(),
    principal_id: "principal-1",
    social_account_id: "account-1",
    platform: "linkedin",
    ...changes,
  });
}

function runTick() {
  return tick.handler({ step });
}

const realDateNow = Date.now;

beforeEach(() => {
  Date.now = () => NOW_MS;
  world.posts = [];
  world.isReadFailing = false;
  world.failingFinalizeIds = new Set();
  world.finalizeCalls = [];
  world.sentEvents = [];
});

afterEach(() => {
  Date.now = realDateNow;
});

describe("the hourly safety net and posts left in processing", () => {
  test("settles a post in processing for longer than any run can hold it, and leaves a younger one to its run", async () => {
    storePost({ id: "stuck" });
    storePost({ id: "running", updated_at: new Date(NOW_MS - 10 * 60 * 1000).toISOString() });
    storePost({ id: "posted", status: "posted" });

    await runTick();

    expect(world.finalizeCalls.map((call) => call.postId)).toEqual(["stuck"]);
    expect(world.finalizeCalls[0]?.failureMessage).toContain("may have published");
  });

  test("still settles a stuck post when no post is due", async () => {
    storePost({ id: "stuck" });
    const summary = await runTick();
    expect(world.sentEvents).toEqual([]);
    expect(summary).toMatchObject({ sent: 0, settled: 1 });
  });

  test("a settle that fails throws after trying every post, so Inngest retries the step", async () => {
    storePost({ id: "first" });
    storePost({ id: "second" });
    world.failingFinalizeIds = new Set(["first"]);
    await expect(runTick()).rejects.toThrow("first");
    expect(world.finalizeCalls.map((call) => call.postId)).toEqual(["first", "second"]);
  });
});
