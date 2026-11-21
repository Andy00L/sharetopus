import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

type CompiledStatement = { sql: string; params: unknown[] };
type QueryReply = { data: object[]; error: null } | { data: null; error: { message: string; code: string } };

const NOW = new Date("2026-11-21T12:00:00.000Z");
const FUTURE_ISO = "2026-12-01T00:00:00.000Z";
const PAST_ISO = "2026-11-01T00:00:00.000Z";

const resumedPrincipalIds: string[] = [];
const executedStatements: CompiledStatement[] = [];
let principalRows: { principal_id: string }[] = [];
let subscribedRows: { user_id: string }[] = [];
let referralRows: { id: string; creator_access_until: string | null }[] = [];
let failingTable: string | null = null;

function hasToSQL(query: unknown): query is { toSQL: () => CompiledStatement } {
  return typeof query === "object" && query !== null && "toSQL" in query;
}

function replyFor(statement: CompiledStatement): QueryReply {
  if (failingTable && statement.sql.includes(`from "${failingTable}"`)) {
    return { data: null, error: { message: "read failed", code: "XX000" } };
  }
  if (statement.sql.startsWith("delete")) return { data: [{ id: "deleted-post" }], error: null };
  if (statement.sql.includes('from "stripe_subscriptions"')) return { data: subscribedRows, error: null };
  if (statement.sql.includes('from "users"')) return { data: referralRows, error: null };
  return { data: principalRows, error: null };
}

mock.module("server-only", () => ({}));

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: unknown) => {
    if (!hasToSQL(query)) throw new Error("[runQuery mock] unexpected query");
    const statement = query.toSQL();
    executedStatements.push(statement);
    return replyFor(statement);
  },
}));

mock.module("./resumeCancelledPostsOnResubscribe", () => ({
  resumeCancelledPostsOnResubscribe: async (principalId: string) => {
    resumedPrincipalIds.push(principalId);
    return { success: true, resumed: 2, bumped: 0 };
  },
}));

const { cleanupCancelledPostsAfterGrace } = await import("./cleanupCancelledPostsAfterGrace");

function findDeleteStatements(): CompiledStatement[] {
  return executedStatements.filter((statement) => statement.sql.startsWith("delete"));
}

beforeEach(() => {
  resumedPrincipalIds.length = 0;
  executedStatements.length = 0;
  principalRows = [];
  subscribedRows = [];
  referralRows = [];
  failingTable = null;
});

describe("cleanupCancelledPostsAfterGrace", () => {
  test("resumes principals with a subscription or unexpired referral access, deletes only the others", async () => {
    principalRows = [
      { principal_id: "user_subscribed" },
      { principal_id: "user_referral" },
      { principal_id: "user_referral_expired" },
      { principal_id: "user_gone" },
    ];
    subscribedRows = [{ user_id: "user_subscribed" }];
    referralRows = [
      { id: "user_referral", creator_access_until: FUTURE_ISO },
      { id: "user_referral_expired", creator_access_until: PAST_ISO },
    ];

    const result = await cleanupCancelledPostsAfterGrace(NOW);

    expect(resumedPrincipalIds.sort()).toEqual(["user_referral", "user_subscribed"]);
    const deleteStatements = findDeleteStatements();
    expect(deleteStatements).toHaveLength(1);
    expect(deleteStatements[0].params).toEqual(
      expect.arrayContaining(["user_referral_expired", "user_gone"]),
    );
    expect(deleteStatements[0].params).not.toContain("user_subscribed");
    expect(deleteStatements[0].params).not.toContain("user_referral");
    expect(result).toEqual({
      success: true,
      principalsChecked: 4,
      principalsResumed: 2,
      resumedPosts: 4,
      deleted: 1,
    });
  });

  test("looks up access in two reads whatever the number of principals", async () => {
    principalRows = Array.from({ length: 300 }, (_entry, principalIndex) => ({ principal_id: `user_${principalIndex}` }));

    await cleanupCancelledPostsAfterGrace(NOW);

    const accessReads = executedStatements.filter(
      (statement) =>
        statement.sql.includes('from "stripe_subscriptions"') || statement.sql.includes('from "users"'),
    );
    expect(accessReads).toHaveLength(2);
  });

  test("deletes nothing when an access read fails", async () => {
    for (const table of ["stripe_subscriptions", "users"]) {
      executedStatements.length = 0;
      principalRows = [{ principal_id: "user_unknown" }];
      failingTable = table;

      const result = await cleanupCancelledPostsAfterGrace(NOW);

      expect(result.success).toBe(false);
      expect(findDeleteStatements()).toHaveLength(0);
      expect(resumedPrincipalIds).toHaveLength(0);
    }
  });
});
