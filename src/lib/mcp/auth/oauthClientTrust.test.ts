import { describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

type ScriptedResults = {
  existingRows: unknown[];
  insertedRows: unknown[];
  readBackRows: unknown[];
};

let scriptedResults: ScriptedResults = { existingRows: [], insertedRows: [], readBackRows: [] };
let executedStatements: string[] = [];

function describeStatement(query: unknown): string {
  if (typeof query === "object" && query !== null && "toSQL" in query && typeof query.toSQL === "function") {
    const compiled: unknown = query.toSQL();
    if (typeof compiled === "object" && compiled !== null && "sql" in compiled && typeof compiled.sql === "string") {
      return compiled.sql.startsWith("insert") ? "insert" : "select";
    }
  }
  return "count";
}

mock.module("server-only", () => ({}));
mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: unknown) => {
    const statementKind = describeStatement(query);
    executedStatements.push(statementKind);
    if (statementKind === "count") return { data: 0, error: null };
    if (statementKind === "insert") return { data: scriptedResults.insertedRows, error: null };
    const isFirstSelect = executedStatements.filter((kind) => kind === "select").length === 1;
    return {
      data: isFirstSelect ? scriptedResults.existingRows : scriptedResults.readBackRows,
      error: null,
    };
  },
}));
mock.module("@/actions/server/rateLimit/checkRateLimit", () => ({
  checkRateLimit: async () => ({ success: true }),
}));

const { checkOAuthClientTrust } = await import("./oauthClientTrust");

function resetDatabase(results: ScriptedResults): void {
  scriptedResults = results;
  executedStatements = [];
}

describe("checkOAuthClientTrust first sight", () => {
  test("a lost insert race answers and caches the row the database kept", async () => {
    resetDatabase({
      existingRows: [],
      insertedRows: [],
      readBackRows: [{ trust_level: "blocked", revoked_at: null, registered_by_user_id: "user-winner" }],
    });

    const firstAnswer = await checkOAuthClientTrust("https://client.example/lost-race", "user-loser");
    expect(firstAnswer).toEqual({ allowed: false, reason: "blocked" });
    expect(executedStatements).toEqual(["select", "count", "insert", "select"]);

    executedStatements = [];
    const cachedAnswer = await checkOAuthClientTrust("https://client.example/lost-race", "user-loser");
    expect(cachedAnswer).toEqual({ allowed: false, reason: "blocked" });
    expect(executedStatements).toEqual([]);
  });

  test("a lost race whose row is gone fails closed", async () => {
    resetDatabase({ existingRows: [], insertedRows: [], readBackRows: [] });

    const answer = await checkOAuthClientTrust("https://client.example/vanished", "user-1");

    expect(answer).toEqual({ allowed: false, reason: "lookup_failed" });
  });

  test("a won insert allows the client without reading it back", async () => {
    resetDatabase({
      existingRows: [],
      insertedRows: [{ trust_level: "verified", revoked_at: null, registered_by_user_id: "user-1" }],
      readBackRows: [],
    });

    const answer = await checkOAuthClientTrust("https://client.example/new", "user-1");

    expect(answer).toEqual({ allowed: true });
    expect(executedStatements).toEqual(["select", "count", "insert"]);
  });
});
