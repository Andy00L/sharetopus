import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

type CompiledStatement = { sql: string; params: unknown[] };
type StoredPost = { id: string; principal_id: string; status: string; created_via: string };
type SubscriptionRow = { stripe_price_id: string | null; status: string; current_period_end: string | null; start_date: string | null };

const PRINCIPAL_ID = "user_owner";
const FAR_PAST_ISO = "2026-01-01T00:00:00.000Z";

const queryState: {
  posts: StoredPost[];
  subscriptions: SubscriptionRow[];
  referralUntil: string | null;
  isAccessReadFailing: boolean;
  statements: CompiledStatement[];
  sentEvents: unknown[];
} = {
  posts: [],
  subscriptions: [],
  referralUntil: null,
  isAccessReadFailing: false,
  statements: [],
  sentEvents: [],
};

function hasToSQL(query: unknown): query is { toSQL: () => CompiledStatement } {
  return typeof query === "object" && query !== null && "toSQL" in query;
}

function replyFor(statement: CompiledStatement) {
  const isAccessRead =
    statement.sql.includes('from "stripe_subscriptions"') || statement.sql.includes('from "users"');
  if (isAccessRead && queryState.isAccessReadFailing) {
    return { data: null, error: { message: "connection reset", code: "08006" } };
  }
  if (statement.sql.includes('from "stripe_subscriptions"')) {
    return { data: queryState.subscriptions, error: null };
  }
  if (statement.sql.includes('from "users"')) {
    return { data: [{ creator_access_until: queryState.referralUntil }], error: null };
  }
  if (statement.sql.startsWith('update "scheduled_posts"')) {
    const resumedRows = queryState.posts.map((post) => ({
      id: post.id,
      principal_id: post.principal_id,
      social_account_id: "account-1",
      platform: "linkedin",
      scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }));
    return { data: resumedRows, error: null };
  }
  return { data: queryState.posts, error: null };
}

mock.module("server-only", () => ({}));

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: unknown) => {
    if (!hasToSQL(query)) throw new Error("[runQuery mock] unexpected query");
    const statement = query.toSQL();
    queryState.statements.push(statement);
    return replyFor(statement);
  },
}));

mock.module("@/actions/server/rateLimit/checkRateLimit", () => ({
  checkRateLimit: async () => ({ success: true }),
}));

mock.module("@/inngest/client", () => ({
  inngest: {
    send: async (events: unknown[]) => {
      queryState.sentEvents.push(...events);
    },
  },
}));

const { resumeScheduledPostBatch } = await import("./resumeScheduledPostBatch");
const { REVIVE_NEEDS_ACCESS_MESSAGE, REVIVE_ACCESS_UNAVAILABLE_MESSAGE } = await import(
  "./_shared/checkAccessToRevivePosts"
);

function countUpdates(): number {
  return queryState.statements.filter((statement) => statement.sql.startsWith("update")).length;
}

beforeEach(() => {
  queryState.posts = [{ id: "post-1", principal_id: PRINCIPAL_ID, status: "cancelled", created_via: "web" }];
  queryState.subscriptions = [];
  queryState.referralUntil = null;
  queryState.isAccessReadFailing = false;
  queryState.statements = [];
  queryState.sentEvents = [];
});

describe("resumeScheduledPostBatch", () => {
  test("refuses to resume when the owner has no plan and no referral weeks, and changes nothing", async () => {
    queryState.subscriptions = [{ stripe_price_id: null, status: "past_due", current_period_end: null, start_date: null }];
    queryState.referralUntil = FAR_PAST_ISO;

    const result = await resumeScheduledPostBatch(["post-1"], PRINCIPAL_ID, "web");

    expect(result).toEqual({ success: false, message: REVIVE_NEEDS_ACCESS_MESSAGE });
    expect(countUpdates()).toBe(0);
    expect(queryState.sentEvents).toEqual([]);
  });

  test("an unreadable plan refuses with a retry message and changes nothing", async () => {
    queryState.isAccessReadFailing = true;

    const result = await resumeScheduledPostBatch(["post-1"], PRINCIPAL_ID, "mcp");

    expect(result).toEqual({ success: false, message: REVIVE_ACCESS_UNAVAILABLE_MESSAGE });
    expect(countUpdates()).toBe(0);
  });

  test("resumes and dispatches the post when the owner's plan is active", async () => {
    queryState.subscriptions = [{ stripe_price_id: null, status: "active", current_period_end: null, start_date: null }];

    const result = await resumeScheduledPostBatch(["post-1"], PRINCIPAL_ID, "web");

    expect(result.success).toBe(true);
    expect(countUpdates()).toBe(1);
    expect(queryState.sentEvents).toHaveLength(1);
  });
});
