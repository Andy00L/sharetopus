import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

type CompiledStatement = { sql: string; params: unknown[] };
type DatabaseError = { message: string; code: string | undefined };

const UNIQUE_VIOLATION = "23505";
const executedStatements: CompiledStatement[] = [];
let referrerRows: { user_id: string; email: string }[] = [];
let newUserRows: { email: string }[] = [];
let insertError: DatabaseError | null = null;
let isCodeReadFailing = false;

function hasToSQL(query: unknown): query is { toSQL: () => CompiledStatement } {
  return typeof query === "object" && query !== null && "toSQL" in query;
}

mock.module("server-only", () => ({}));

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  isUniqueViolation: (error: DatabaseError) => error.code === UNIQUE_VIOLATION,
  runQuery: async (query: unknown) => {
    if (!hasToSQL(query)) throw new Error("[runQuery mock] unexpected query");
    const statement = query.toSQL();
    executedStatements.push(statement);
    if (statement.sql.startsWith("insert")) return { data: [], error: insertError };
    if (statement.sql.includes('from "referral_codes"')) {
      return isCodeReadFailing
        ? { data: null, error: { message: "read failed", code: "XX000" } }
        : { data: referrerRows, error: null };
    }
    return { data: newUserRows, error: null };
  },
}));

const { recordReferralOnSignup } = await import("./recordReferralOnSignup");

function findInserts(): CompiledStatement[] {
  return executedStatements.filter((statement) => statement.sql.startsWith("insert"));
}

beforeEach(() => {
  executedStatements.length = 0;
  referrerRows = [{ user_id: "user_referrer", email: "referrer@example.com" }];
  newUserRows = [{ email: "new@example.com" }];
  insertError = null;
  isCodeReadFailing = false;
});

describe("recordReferralOnSignup", () => {
  test("records a verified referral and names the referrer", async () => {
    const outcome = await recordReferralOnSignup({ newUserId: "user_new", referralCode: "ABC1234" });

    expect(outcome).toEqual({ kind: "recorded", referrerId: "user_referrer" });
    expect(findInserts()).toHaveLength(1);
    expect(findInserts()[0].params).toEqual(expect.arrayContaining(["user_referrer", "user_new", "verified"]));
  });

  test("a referral already recorded still counts as recorded, so a retry reaches the grant", async () => {
    insertError = { message: "duplicate key", code: UNIQUE_VIOLATION };

    const outcome = await recordReferralOnSignup({ newUserId: "user_new", referralCode: "ABC1234" });

    expect(outcome).toEqual({ kind: "recorded", referrerId: "user_referrer" });
  });

  test("does not attribute an unknown code or a self-referral by id or by email", async () => {
    referrerRows = [];
    expect(await recordReferralOnSignup({ newUserId: "user_new", referralCode: "NOPE" })).toEqual({
      kind: "not_attributed",
      reason: "unknown_code",
    });

    referrerRows = [{ user_id: "user_new", email: "other@example.com" }];
    expect((await recordReferralOnSignup({ newUserId: "user_new", referralCode: "ABC1234" })).kind).toBe("not_attributed");

    referrerRows = [{ user_id: "user_referrer", email: "New@Example.com" }];
    expect(await recordReferralOnSignup({ newUserId: "user_new", referralCode: "ABC1234" })).toEqual({
      kind: "not_attributed",
      reason: "self_referral",
    });
    expect(findInserts()).toHaveLength(0);
  });

  test("reports a read or insert failure as failed", async () => {
    isCodeReadFailing = true;
    expect((await recordReferralOnSignup({ newUserId: "user_new", referralCode: "ABC1234" })).kind).toBe("failed");

    isCodeReadFailing = false;
    insertError = { message: "connection reset", code: undefined };
    expect((await recordReferralOnSignup({ newUserId: "user_new", referralCode: "ABC1234" })).kind).toBe("failed");
  });
});
