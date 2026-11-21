import { describe, expect, mock, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

mock.module("server-only", () => ({}));

mock.module("@/inngest/client", () => ({
  inngest: { createFunction: (config: unknown, handler: unknown) => ({ config, handler }) },
}));

mock.module("@/db/client", () => ({
  db: drizzle(postgres("postgres://never-connected.invalid/test")),
  runQuery: async () => ({ data: null, error: { message: "not used", code: null } }),
}));

process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { buildPlaintextColumnQueries, PLAINTEXT_COLUMN_PASSES } = await import(
  "./encryptPlaintextSecretsCron"
);

describe("encryptPlaintextSecretsCron column passes", () => {
  test("every pass selects with the prefix pattern bound raw, not encrypted", () => {
    for (const pass of PLAINTEXT_COLUMN_PASSES) {
      const { sql: selectSql, params } = buildPlaintextColumnQueries(pass).selectPlaintext.toSQL();
      expect(selectSql).toContain(` not like $1`);
      expect(params[0]).toBe("enc:v1:%");
    }
  });

  test("every pass writes its own column encrypted and only while the stored value is unchanged", () => {
    for (const pass of PLAINTEXT_COLUMN_PASSES) {
      const tableName = pass.label.split(".")[0];
      const columnName = pass.label.split(".")[1];
      const { sql: updateSql, params } = buildPlaintextColumnQueries(pass)
        .rewriteIfUnchanged({ id: "00000000-0000-0000-0000-000000000001", storedValue: "plain-secret" })
        .toSQL();

      expect(updateSql).toContain(`set "${columnName}" = $1`);
      expect(String(params[0]).startsWith("enc:v1:")).toBe(true);
      expect(updateSql).toMatch(
        new RegExp(`where \\("${tableName}"\\."id" = \\$\\d+ and "${tableName}"\\."${columnName}" = \\$\\d+\\)$`),
      );
      expect(params.at(-1)).toBe("plain-secret");
    }
  });
});
