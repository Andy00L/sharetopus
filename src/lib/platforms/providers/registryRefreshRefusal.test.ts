import { beforeEach, describe, expect, mock, test } from "bun:test";

import { drizzle } from "drizzle-orm/postgres-js";

import type { StoredCredential } from "@/lib/api/refreshWithAccountLock";
import type { SocialAccount } from "@/lib/types/dbTypes";

import type { ProviderDefinition, ProviderRefreshResult } from "./types";

mock.module("server-only", () => ({}));

const REFUSED_EXPIRES_AT = "2026-11-20T00:00:00.000Z";

type StoredAccountRow = StoredCredential & { is_available: boolean };

let storedAccountRow: StoredAccountRow;
let rowSavedAfterReread: StoredAccountRow | null = null;
let flagWriteCount = 0;
let selectCount = 0;

type BuiltQuery = { toSQL: () => { sql: string; params: unknown[] } };

function isFlagGuardMet(builtSql: { sql: string; params: unknown[] }): boolean {
  return storedAccountRow.token_expires_at === null
    ? builtSql.sql.includes('"token_expires_at" is null')
    : builtSql.params.includes(storedAccountRow.token_expires_at);
}

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: BuiltQuery) => {
    const builtSql = query.toSQL();
    if (builtSql.sql.startsWith("select")) {
      selectCount += 1;
      const { access_token, refresh_token, token_expires_at } = storedAccountRow;
      const isRefusalReread = selectCount === 2;
      if (rowSavedAfterReread && isRefusalReread) storedAccountRow = rowSavedAfterReread;
      return { data: [{ access_token, refresh_token, token_expires_at }], error: null };
    }
    const isFlagWrite =
      builtSql.sql.includes('"is_available"') && builtSql.params.includes(false);
    const isFlagApplied = isFlagWrite && isFlagGuardMet(builtSql);
    if (isFlagApplied) {
      storedAccountRow.is_available = false;
      flagWriteCount += 1;
    }
    const returnsRows = builtSql.sql.includes(" returning ");
    return { data: isFlagApplied && returnsRows ? [{ id: "account-1" }] : [], error: null };
  },
}));

mock.module("@/actions/server/contentHistoryActions/storeContentHistory", () => ({
  storeContentHistory: async () => ({ success: true }),
}));

mock.module("@/actions/api/upstash", () => ({
  redis: { set: async () => "OK", eval: async () => 1 },
}));

let answerRefresh: () => ProviderRefreshResult;
const realRegistry = await import("./registry");
mock.module("./registry", () => ({
  ...realRegistry,
  resolveConfiguredProvider: () => {
    const bluesky = realRegistry.getProvider("bluesky");
    if (!bluesky) throw new Error("bluesky is not registered");
    const provider: ProviderDefinition = {
      ...bluesky,
      refresh: async () => answerRefresh(),
      refreshTokenRotation: "rotating",
    };
    return { ok: true, provider };
  },
}));

const { refreshRegistryAccountToken } = await import("./publishViaRegistry");

const EXPIRED_ACCOUNT: SocialAccount = {
  id: "account-1",
  principal_id: "principal-1",
  platform: "bluesky",
  account_identifier: "did:plc:abc",
  display_name: null,
  username: null,
  email_address: null,
  avatar_url: null,
  is_verified: null,
  follower_count: null,
  following_count: null,
  bio_description: null,
  is_available: true,
  connection_id: null,
  extra: { service: "https://bsky.social", did: "did:plc:abc" },
  created_at: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-11-01T00:00:00.000Z",
  deleted_at: null,
  access_token: "old-access",
  refresh_token: "old-refresh",
  token_expires_at: REFUSED_EXPIRES_AT,
};

const REFUSED_REFRESH: ProviderRefreshResult = {
  ok: false,
  message: "invalid_grant",
  reason: "auth_expired",
};

beforeEach(() => {
  flagWriteCount = 0;
  selectCount = 0;
  rowSavedAfterReread = null;
  storedAccountRow = {
    access_token: "old-access",
    refresh_token: "old-refresh",
    token_expires_at: REFUSED_EXPIRES_AT,
    is_available: true,
  };
});

describe("a refused registry refresh flags the account", () => {
  test("a platform refusal flags the account once and asks for a reconnect", async () => {
    answerRefresh = () => REFUSED_REFRESH;
    const tokenResult = await refreshRegistryAccountToken(EXPIRED_ACCOUNT);
    expect(tokenResult.success ? null : tokenResult.reason).toBe("auth_expired");
    expect(flagWriteCount).toBe(1);
    expect(storedAccountRow.is_available).toBe(false);
  });

  test("a transient failure flags nothing", async () => {
    answerRefresh = () => ({ ok: false, message: "HTTP 502", reason: "transient" });
    const tokenResult = await refreshRegistryAccountToken(EXPIRED_ACCOUNT);
    expect(tokenResult.success ? null : tokenResult.reason).toBe("transient");
    expect(flagWriteCount).toBe(0);
    expect(storedAccountRow.is_available).toBe(true);
  });

  test("a token another run saved meanwhile is used, not flagged", async () => {
    const savedElsewhereExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    answerRefresh = () => {
      storedAccountRow = {
        access_token: "access-saved-by-another-run",
        refresh_token: "refresh-saved-by-another-run",
        token_expires_at: savedElsewhereExpiresAt,
        is_available: true,
      };
      return REFUSED_REFRESH;
    };
    const tokenResult = await refreshRegistryAccountToken(EXPIRED_ACCOUNT);
    expect(tokenResult).toEqual({
      success: true,
      accessToken: "access-saved-by-another-run",
      reconnectWarning: null,
    });
    expect(flagWriteCount).toBe(0);
    expect(storedAccountRow.is_available).toBe(true);
  });

  test("a token saved after the re-read keeps its row unflagged and is returned", async () => {
    answerRefresh = () => REFUSED_REFRESH;
    rowSavedAfterReread = {
      access_token: "access-saved-late",
      refresh_token: "refresh-saved-late",
      token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      is_available: true,
    };
    const tokenResult = await refreshRegistryAccountToken(EXPIRED_ACCOUNT);
    expect(tokenResult).toEqual({
      success: true,
      accessToken: "access-saved-late",
      reconnectWarning: null,
    });
    expect(flagWriteCount).toBe(0);
    expect(storedAccountRow.is_available).toBe(true);
  });
});
