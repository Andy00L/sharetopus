import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

import type { PostStatus } from "@/db/schema";

type StoredAccount = { id: string; principal_id: string; platform: "tiktok" };
type StoredScheduledPost = {
  id: string;
  social_account_id: string;
  status: PostStatus;
  media_storage_path: string;
};
type StoredDirectPost = {
  event_id: string;
  social_account_id: string;
  status: "processing" | "completed" | "failed";
};

const PRINCIPAL_ID = "principal-1";
const PUBLISHING_REFUSAL = "A post on this account is publishing now. Try again in a minute.";

const NOT_EXISTS_PATTERN =
  /not exists \(select "\w+" from "(\w+)" where \("\w+"\."social_account_id" = \$(\d+) and "\w+"\."status" = \$(\d+)\)\)/g;

const world: {
  accounts: Map<string, StoredAccount>;
  scheduledPosts: StoredScheduledPost[];
  directPosts: StoredDirectPost[];
  cleanedPaths: string[];
} = { accounts: new Map(), scheduledPosts: [], directPosts: [], cleanedPaths: [] };

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

function readParam(params: unknown[], placeholderNumber: string): unknown {
  return params[Number(placeholderNumber) - 1];
}

function findRowsByTable(table: string): { social_account_id: string; status: string }[] {
  if (table === "scheduled_posts") return world.scheduledPosts;
  if (table === "pending_direct_posts") return world.directPosts;
  throw new Error(`Unexpected table in not exists: ${table}`);
}

function hasBlockingRow(sql: string, params: unknown[]): boolean {
  return [...sql.matchAll(NOT_EXISTS_PATTERN)].some(([, table, accountParam, statusParam]) =>
    findRowsByTable(table).some(
      (row) =>
        row.social_account_id === readParam(params, accountParam) &&
        row.status === readParam(params, statusParam),
    ),
  );
}

function deleteAccountWithCascade(accountId: string): void {
  world.accounts.delete(accountId);
  world.scheduledPosts = world.scheduledPosts.filter((post) => post.social_account_id !== accountId);
  world.directPosts = world.directPosts.filter((post) => post.social_account_id !== accountId);
}

mock.module("server-only", () => ({}));

mock.module("@/actions/server/rateLimit/checkRateLimit", () => ({
  checkRateLimit: async () => ({ success: true }),
}));

mock.module("@/actions/server/data/storageFiles/deleteSupabaseFile", () => ({
  deleteUnreferencedMediaFiles: async (_principalId: string, filePaths: string[]) => {
    world.cleanedPaths.push(...filePaths);
    return { success: true, removedCount: filePaths.length, preservedCount: 0 };
  },
}));

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: unknown) => {
    const { sql, params } = readStatement(query);
    if (sql.startsWith('select "principal_id", "platform" from "social_accounts"')) {
      const account = world.accounts.get(String(params[0]));
      return { data: account ? [account] : [], error: null };
    }
    if (sql.startsWith('select distinct "media_storage_path" from "scheduled_posts"')) {
      const [accountId, ...statuses] = params;
      const mediaPaths = world.scheduledPosts
        .filter((post) => post.social_account_id === accountId && statuses.includes(post.status))
        .map((post) => ({ media_storage_path: post.media_storage_path }));
      return { data: mediaPaths, error: null };
    }
    if (sql.startsWith('delete from "social_accounts"')) {
      const accountId = String(params[0]);
      if (!world.accounts.has(accountId) || hasBlockingRow(sql, params)) {
        return { data: [], error: null };
      }
      deleteAccountWithCascade(accountId);
      return { data: [{ id: accountId }], error: null };
    }
    throw new Error(`Unexpected statement: ${sql}`);
  },
}));

const { disconnectSocialAccount } = await import("./disconnectSocialAccount");

function storeAccount(accountId: string): void {
  world.accounts.set(accountId, { id: accountId, principal_id: PRINCIPAL_ID, platform: "tiktok" });
}

function storeScheduledPost(postId: string, accountId: string, status: PostStatus): void {
  world.scheduledPosts.push({
    id: postId,
    social_account_id: accountId,
    status,
    media_storage_path: `${PRINCIPAL_ID}/${postId}.mp4`,
  });
}

function storeDirectPost(eventId: string, accountId: string, status: StoredDirectPost["status"]): void {
  world.directPosts.push({ event_id: eventId, social_account_id: accountId, status });
}

beforeEach(() => {
  world.accounts = new Map();
  world.scheduledPosts = [];
  world.directPosts = [];
  world.cleanedPaths = [];
  storeAccount("account-1");
});

describe("disconnecting an account while one of its posts is publishing", () => {
  test("a scheduled post in processing refuses the disconnect, and the account and post stay", async () => {
    storeScheduledPost("post-1", "account-1", "processing");

    const result = await disconnectSocialAccount("account-1", PRINCIPAL_ID);

    expect(result).toEqual({ success: false, message: PUBLISHING_REFUSAL });
    expect(world.accounts.has("account-1")).toBe(true);
    expect(world.scheduledPosts.map((post) => post.id)).toEqual(["post-1"]);
    expect(world.cleanedPaths).toEqual([]);
  });

  test("a post-now in processing refuses the disconnect, and its dispatch row stays", async () => {
    storeDirectPost("dispatch-1", "account-1", "processing");

    const result = await disconnectSocialAccount("account-1", PRINCIPAL_ID);

    expect(result).toEqual({ success: false, message: PUBLISHING_REFUSAL });
    expect(world.directPosts.map((post) => post.event_id)).toEqual(["dispatch-1"]);
  });

  test("a post publishing on another account does not block it", async () => {
    storeAccount("account-2");
    storeScheduledPost("post-2", "account-2", "processing");
    storeDirectPost("dispatch-2", "account-2", "processing");

    const result = await disconnectSocialAccount("account-1", PRINCIPAL_ID);

    expect(result).toMatchObject({ success: true });
    expect([...world.accounts.keys()]).toEqual(["account-2"]);
  });
});

describe("disconnecting an account with no post publishing", () => {
  test("removes the account with its posts and checks their media for cleanup", async () => {
    storeScheduledPost("post-1", "account-1", "scheduled");
    storeScheduledPost("post-2", "account-1", "posted");
    storeDirectPost("dispatch-1", "account-1", "completed");

    const result = await disconnectSocialAccount("account-1", PRINCIPAL_ID);

    expect(result).toEqual({
      success: true,
      message: "Tiktok account disconnected and 1 unused media files cleaned up.",
    });
    expect(world.accounts.size).toBe(0);
    expect(world.scheduledPosts).toEqual([]);
    expect(world.directPosts).toEqual([]);
    expect(world.cleanedPaths).toEqual([`${PRINCIPAL_ID}/post-1.mp4`]);
  });
});
