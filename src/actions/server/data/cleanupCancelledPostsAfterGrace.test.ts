import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

type AccessStatus = "active" | "none" | "unavailable";

const accessByPrincipal = new Map<string, AccessStatus>();
const resumedPrincipalIds: string[] = [];
const deleteStatements: { sql: string; params: unknown[] }[] = [];
let principalRows: { principal_id: string }[] = [];

function hasToSQL(query: unknown): query is { toSQL: () => { sql: string; params: unknown[] } } {
  return typeof query === "object" && query !== null && "toSQL" in query;
}

mock.module("server-only", () => ({}));

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: unknown) => {
    if (!hasToSQL(query)) throw new Error("[runQuery mock] unexpected query");
    const statement = query.toSQL();
    if (statement.sql.startsWith("delete")) {
      deleteStatements.push(statement);
      return { data: [{ id: "deleted-post" }], error: null };
    }
    return { data: principalRows, error: null };
  },
}));

mock.module("@/actions/checkActiveSubscription", () => ({
  checkActiveSubscription: async (principalId: string) => {
    const status = accessByPrincipal.get(principalId) ?? "none";
    return { isActive: status === "active", status };
  },
}));

mock.module("./resumeCancelledPostsOnResubscribe", () => ({
  resumeCancelledPostsOnResubscribe: async (principalId: string) => {
    resumedPrincipalIds.push(principalId);
    return { success: true, resumed: 2, bumped: 0 };
  },
}));

const { cleanupCancelledPostsAfterGrace } = await import("./cleanupCancelledPostsAfterGrace");

beforeEach(() => {
  accessByPrincipal.clear();
  resumedPrincipalIds.length = 0;
  deleteStatements.length = 0;
  principalRows = [];
});

describe("cleanupCancelledPostsAfterGrace", () => {
  test("resumes a principal who has access again instead of skipping them", async () => {
    principalRows = [{ principal_id: "user_back" }];
    accessByPrincipal.set("user_back", "active");

    const result = await cleanupCancelledPostsAfterGrace();

    expect(resumedPrincipalIds).toEqual(["user_back"]);
    expect(deleteStatements).toHaveLength(0);
    expect(result).toEqual({
      success: true,
      principalsChecked: 1,
      principalsResumed: 1,
      resumedPosts: 2,
      deleted: 0,
    });
  });

  test("deletes only the posts of principals without access", async () => {
    principalRows = [{ principal_id: "user_back" }, { principal_id: "user_gone" }];
    accessByPrincipal.set("user_back", "active");

    await cleanupCancelledPostsAfterGrace();

    expect(deleteStatements).toHaveLength(1);
    expect(deleteStatements[0].params).toContain("user_gone");
    expect(deleteStatements[0].params).not.toContain("user_back");
  });

  test("fails the run when an access check fails, after handling the others", async () => {
    principalRows = [{ principal_id: "user_unknown" }, { principal_id: "user_gone" }];
    accessByPrincipal.set("user_unknown", "unavailable");

    const result = await cleanupCancelledPostsAfterGrace();

    expect(result.success).toBe(false);
    expect(deleteStatements).toHaveLength(1);
    expect(deleteStatements[0].params).not.toContain("user_unknown");
  });
});
