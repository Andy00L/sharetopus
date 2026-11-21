import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

type CompiledStatement = { sql: string; params: unknown[] };

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const insertedStatements: CompiledStatement[] = [];
const revokeCalls: { principalId: string; keyId: string; kind: string }[] = [];

function hasToSQL(query: unknown): query is { toSQL: () => CompiledStatement } {
  return typeof query === "object" && query !== null && "toSQL" in query;
}

mock.module("server-only", () => ({}));
mock.module("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "user_owner" }) }));
mock.module("@/actions/server/rateLimit/checkRateLimit", () => ({
  checkRateLimit: async () => ({ success: true }),
}));
mock.module("@/actions/checkActiveSubscription", () => ({
  checkActiveSubscription: async () => ({ isActive: true, status: "active" }),
}));
mock.module("@/lib/api/checkActiveApiKeyCap", () => ({
  checkActiveApiKeyCap: async () => ({ ok: true }),
}));
mock.module("@/lib/api/revokeApiKeyForPrincipal", () => ({
  revokeApiKeyForPrincipal: async (principalId: string, keyId: string, kind: string) => {
    revokeCalls.push({ principalId, keyId, kind });
    return { success: true, message: "API key revoked." };
  },
}));
mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: unknown) => {
    if (!hasToSQL(query)) throw new Error("[runQuery mock] unexpected query");
    insertedStatements.push(query.toSQL());
    return { data: [{ id: "key-1" }], error: null };
  },
}));

const { createApiKey, revokeApiKey } = await import("./apiKeys");

type CreateInput = Parameters<typeof createApiKey>[0];
type RevokeInput = Parameters<typeof revokeApiKey>[0];

function parseUntrustedCreateInput(payload: string): CreateInput {
  return JSON.parse(payload);
}

function parseUntrustedRevokeInput(payload: string): RevokeInput {
  return JSON.parse(payload);
}

beforeEach(() => {
  insertedStatements.length = 0;
  revokeCalls.length = 0;
});

describe("createApiKey", () => {
  test("a missing expiresInDays creates a key that expires in the default 90 days", async () => {
    const result = await createApiKey({ kind: "rest", name: "CI key" });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const lifetimeDays = (new Date(result.expiresAtIso).getTime() - Date.now()) / MS_PER_DAY;
    expect(Math.round(lifetimeDays)).toBe(90);
  });

  test("answers a message instead of throwing on a null or malformed input", async () => {
    for (const payload of ["null", '{"kind":"rest","name":42}', '{"kind":"wallet","name":"key"}', '{"kind":"mcp","name":"key","expiresInDays":12}']) {
      const result = await createApiKey(parseUntrustedCreateInput(payload));
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(result.message.length).toBeGreaterThan(0);
    }
    expect(insertedStatements).toHaveLength(0);
  });

  test("names the rule a bad name breaks", async () => {
    expect(await createApiKey({ kind: "mcp", name: "   ", expiresInDays: 30 })).toEqual({
      success: false,
      message: "Key name is required.",
    });
    expect(await createApiKey({ kind: "mcp", name: "x".repeat(101), expiresInDays: 30 })).toEqual({
      success: false,
      message: "Key name must be at most 100 characters.",
    });
  });
});

describe("revokeApiKey", () => {
  test("answers a message instead of throwing on a null or malformed input", async () => {
    for (const payload of ["null", '{"kind":"rest"}', '{"kind":"other","keyId":"abc"}']) {
      const result = await revokeApiKey(parseUntrustedRevokeInput(payload));
      expect(result.success).toBe(false);
    }
    expect(revokeCalls).toHaveLength(0);
  });

  test("revokes the owner's key of the given kind", async () => {
    await revokeApiKey({ kind: "mcp", keyId: "key-1" });

    expect(revokeCalls).toEqual([{ principalId: "user_owner", keyId: "key-1", kind: "mcp" }]);
  });
});
