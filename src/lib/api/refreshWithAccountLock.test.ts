import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { StoredCredential } from "./refreshWithAccountLock";

mock.module("server-only", () => ({}));

let lockReplies: Array<"OK" | null> = [];

mock.module("@/actions/api/upstash", () => ({
  redis: {
    set: async () => (lockReplies.length > 0 ? lockReplies.shift() : "OK"),
    eval: async () => 1,
  },
}));

function buildChainableQuery(): object {
  const chainableQuery: object = new Proxy(() => chainableQuery, {
    get: () => () => chainableQuery,
    apply: () => chainableQuery,
  });
  return chainableQuery;
}

let storedRows: StoredCredential[] = [];

mock.module("@/db/client", () => ({
  db: buildChainableQuery(),
  runQuery: async () => ({ data: storedRows, error: null }),
}));

const { refreshWithAccountLock } = await import("./refreshWithAccountLock");

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;

function buildCredential(accessToken: string, expiresInDays: number): StoredCredential {
  return {
    access_token: accessToken,
    refresh_token: "refresh-1",
    token_expires_at: new Date(Date.now() + expiresInDays * DAY_MS).toISOString(),
  };
}

let refreshedFrom: StoredCredential[] = [];

async function refreshStoredCredential(stored: StoredCredential): Promise<string> {
  refreshedFrom.push(stored);
  return "new-token";
}

beforeEach(() => {
  lockReplies = [];
  refreshedFrom = [];
});

describe("refreshWithAccountLock refresh window", () => {
  test("the lock holder keeps a token that expires in 3 days by default and refreshes it under a 7-day window", async () => {
    const expiresInThreeDays = buildCredential("stored-token", 3);
    storedRows = [expiresInThreeDays];

    expect(await refreshWithAccountLock("account-1", refreshStoredCredential)).toEqual({
      kind: "stored_token_fresh",
      accessToken: "stored-token",
    });
    expect(refreshedFrom).toEqual([]);

    expect(
      await refreshWithAccountLock("account-1", refreshStoredCredential, {
        refreshIfExpiringWithinMs: SEVEN_DAYS_MS,
      }),
    ).toEqual({ kind: "refreshed", value: "new-token" });
    expect(refreshedFrom).toEqual([expiresInThreeDays]);
  });

  test("a waiter under a 7-day window does not settle for a token that expires in 3 days", async () => {
    lockReplies = [null];
    storedRows = [buildCredential("stored-token", 3)];

    expect(
      await refreshWithAccountLock("account-1", refreshStoredCredential, {
        refreshIfExpiringWithinMs: SEVEN_DAYS_MS,
      }),
    ).toEqual({ kind: "refreshed", value: "new-token" });
    expect(refreshedFrom).toHaveLength(1);
  });

  test("a waiter under a 7-day window returns the token another run saved beyond it", async () => {
    lockReplies = [null];
    storedRows = [buildCredential("saved-by-other-run", 60)];

    expect(
      await refreshWithAccountLock("account-1", refreshStoredCredential, {
        refreshIfExpiringWithinMs: SEVEN_DAYS_MS,
      }),
    ).toEqual({ kind: "stored_token_fresh", accessToken: "saved-by-other-run" });
    expect(refreshedFrom).toEqual([]);
  });
});
