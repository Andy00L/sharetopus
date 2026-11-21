import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

type CompiledStatement = { sql: string; params: unknown[] };
type StoredPost = { id: string; principal_id: string; status: string; created_via: string };

const PRINCIPAL_ID = "user_owner";
const LATER_ISO = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const queryState: {
  posts: StoredPost[];
  isAccessReadFailing: boolean;
  statements: CompiledStatement[];
} = { posts: [], isAccessReadFailing: false, statements: [] };

function hasToSQL(query: unknown): query is { toSQL: () => CompiledStatement } {
  return typeof query === "object" && query !== null && "toSQL" in query;
}

function isAccessRead(statement: CompiledStatement): boolean {
  return statement.sql.includes('from "stripe_subscriptions"') || statement.sql.includes('from "users"');
}

function replyFor(statement: CompiledStatement) {
  if (isAccessRead(statement)) {
    return queryState.isAccessReadFailing
      ? { data: null, error: { message: "connection reset", code: "08006" } }
      : { data: [], error: null };
  }
  if (statement.sql.startsWith('update "scheduled_posts"')) {
    const movedRows = queryState.posts.map((post) => ({
      id: post.id,
      principal_id: post.principal_id,
      social_account_id: "account-1",
      platform: "linkedin",
      scheduled_at: LATER_ISO,
    }));
    return { data: movedRows, error: null };
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
  inngest: { send: async () => undefined },
}));

const { updateScheduledTimeBatch } = await import("./updateScheduledTimeBatch");
const { REVIVE_NEEDS_ACCESS_MESSAGE } = await import("../resume/_shared/checkAccessToRevivePosts");

function countUpdates(): number {
  return queryState.statements.filter((statement) => statement.sql.startsWith("update")).length;
}

function storePost(status: string, createdVia: string): void {
  queryState.posts = [{ id: "post-1", principal_id: PRINCIPAL_ID, status, created_via: createdVia }];
}

beforeEach(() => {
  queryState.posts = [];
  queryState.isAccessReadFailing = false;
  queryState.statements = [];
});

describe("updateScheduledTimeBatch", () => {
  test("moving a cancelled post is refused when the owner has no access, and changes nothing", async () => {
    storePost("cancelled", "web");

    const result = await updateScheduledTimeBatch(["post-1"], LATER_ISO, PRINCIPAL_ID, "web");

    expect(result).toEqual({ success: false, failure: "access_required", message: REVIVE_NEEDS_ACCESS_MESSAGE });
    expect(countUpdates()).toBe(0);
  });

  test("moving a post that is still scheduled needs no access check", async () => {
    storePost("scheduled", "web");

    const result = await updateScheduledTimeBatch(["post-1"], LATER_ISO, PRINCIPAL_ID, "web");

    expect(result.success).toBe(true);
    expect(queryState.statements.some(isAccessRead)).toBe(false);
  });

  test("a cancelled x402 post was paid for and comes back without reading a plan", async () => {
    queryState.posts = [{ id: "post-1", principal_id: "wallet_owner", status: "cancelled", created_via: "x402" }];
    queryState.isAccessReadFailing = true;

    const result = await updateScheduledTimeBatch(["post-1"], LATER_ISO, "wallet_owner", "x402");

    expect(result.success).toBe(true);
    expect(countUpdates()).toBe(1);
  });
});
