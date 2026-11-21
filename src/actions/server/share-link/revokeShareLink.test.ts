import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

const executedStatements: string[] = [];

function hasToSQL(query: unknown): query is { toSQL: () => { sql: string } } {
  return typeof query === "object" && query !== null && "toSQL" in query;
}

mock.module("server-only", () => ({}));
mock.module("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "user_owner" }) }));
mock.module("@/lib/x402/audit/logX402Call", () => ({ logX402Call: () => undefined }));
mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: unknown) => {
    if (!hasToSQL(query)) throw new Error("[runQuery mock] unexpected query");
    executedStatements.push(query.toSQL().sql);
    return { data: [{ id: "8f14e45f-ceea-467f-a8f0-2b1b2c3d4e5f" }], error: null };
  },
}));

const { revokeShareLink } = await import("./revokeShareLink");

beforeEach(() => {
  executedStatements.length = 0;
});

describe("revokeShareLink", () => {
  test("a malformed id answers not_found without a database call", async () => {
    for (const shareLinkId of ["", "not-a-uuid", "8f14e45f"]) {
      const result = await revokeShareLink({ shareLinkId });
      expect(result).toEqual({ success: false, reason: "not_found", message: "Share link not found." });
    }
    expect(executedStatements).toHaveLength(0);
  });

  test("revokes a link with a well-formed id", async () => {
    const result = await revokeShareLink({ shareLinkId: "8F14E45F-CEEA-467F-A8F0-2B1B2C3D4E5F" });

    expect(result).toEqual({ success: true, outcome: "revoked" });
    expect(executedStatements).toHaveLength(1);
  });
});
