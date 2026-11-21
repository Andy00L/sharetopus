import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { StoredCredential } from "@/lib/api/refreshWithAccountLock";
import type { SocialAccount } from "@/lib/types/dbTypes";

mock.module("server-only", () => ({}));

mock.module("@/actions/api/upstash", () => ({
  redis: { set: async () => "OK", eval: async () => 1 },
}));

function buildChainableQuery(): object {
  const chainableQuery: object = new Proxy(() => chainableQuery, {
    get: () => () => chainableQuery,
    apply: () => chainableQuery,
  });
  return chainableQuery;
}

let queuedQueryRows: StoredCredential[][] = [];
let queryCount = 0;

mock.module("@/db/client", () => ({
  db: buildChainableQuery(),
  runQuery: async () => {
    queryCount += 1;
    return { data: queuedQueryRows.shift() ?? [], error: null };
  },
}));

mock.module("@/lib/api/tiktok/data/refreshTikTokToken", () => ({
  default: async () => ({ kind: "rejected", message: "Refresh refused (400, invalid_grant)." }),
}));

const { ensureValidToken } = await import("./ensureValidToken");

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;

function buildCredential(accessToken: string, expiresInDays: number): StoredCredential {
  return {
    access_token: accessToken,
    refresh_token: "refresh-1",
    token_expires_at: new Date(Date.now() + expiresInDays * DAY_MS).toISOString(),
  };
}

const STORED_CREDENTIAL = buildCredential("stored-token", 3);

const ACCOUNT: SocialAccount = {
  id: "account-1",
  principal_id: "principal-1",
  platform: "tiktok",
  account_identifier: "identifier-1",
  display_name: "Account One",
  username: "account_one",
  email_address: null,
  avatar_url: null,
  is_verified: null,
  follower_count: null,
  following_count: null,
  bio_description: null,
  is_available: true,
  connection_id: null,
  extra: {},
  created_at: "2026-11-20T00:00:00.000Z",
  updated_at: "2026-11-20T00:00:00.000Z",
  deleted_at: null,
  ...STORED_CREDENTIAL,
};

beforeEach(() => {
  queuedQueryRows = [];
  queryCount = 0;
});

describe("ensureValidToken with a refresh window", () => {
  test("a refused refresh of a token that still works flags the account instead of returning that token", async () => {
    queuedQueryRows = [[STORED_CREDENTIAL], [STORED_CREDENTIAL], []];

    const tokenResult = await ensureValidToken(ACCOUNT, { refreshIfExpiringWithinMs: SEVEN_DAYS_MS });

    expect(tokenResult).toEqual({
      success: false,
      error: expect.stringContaining("needs to be reconnected"),
      failureReason: "auth_expired",
    });
    expect(queryCount).toBe(3);
  });

  test("a refused refresh returns the token another run saved meanwhile, without flagging", async () => {
    queuedQueryRows = [[STORED_CREDENTIAL], [buildCredential("saved-by-other-run", 60)]];

    const tokenResult = await ensureValidToken(ACCOUNT, { refreshIfExpiringWithinMs: SEVEN_DAYS_MS });

    expect(tokenResult).toEqual({ success: true, token: "saved-by-other-run" });
    expect(queryCount).toBe(2);
  });
});
