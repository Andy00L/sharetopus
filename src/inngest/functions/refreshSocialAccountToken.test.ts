import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

mock.module("@/inngest/client", () => ({
  inngest: {
    createFunction: (config: unknown, handler: (input: unknown) => Promise<unknown>) => ({
      config,
      handler,
    }),
  },
}));

function buildChainableQuery(): object {
  const chainableQuery: object = new Proxy(() => chainableQuery, {
    get: () => () => chainableQuery,
    apply: () => chainableQuery,
  });
  return chainableQuery;
}

type AccountRow = { id: string; platform: string; is_available: boolean; token_expires_at: string | null };
type TokenResult =
  | { success: true; token: string }
  | { success: false; error: string; failureReason: "auth_expired" | "transient" };
type RegistryTokenResult =
  | { success: true; accessToken: string; reconnectWarning: string | null }
  | { success: false; message: string; reason: "auth_expired" | "transient" };

let storedAccountRows: AccountRow[] = [];
let nextTokenResult: TokenResult = { success: true, token: "token" };
let ensureValidTokenCalls = 0;
let ensureValidTokenOptions: unknown = undefined;
let nextRegistryResult: RegistryTokenResult = { success: true, accessToken: "token", reconnectWarning: null };
let registryRefreshOptions: unknown[] = [];

mock.module("@/db/client", () => ({
  db: buildChainableQuery(),
  runQuery: async () => ({ data: storedAccountRows, error: null }),
}));

mock.module("@/lib/api/ensureValidToken", () => ({
  ensureValidToken: async (_account: unknown, options: unknown) => {
    ensureValidTokenCalls += 1;
    ensureValidTokenOptions = options;
    return nextTokenResult;
  },
}));

mock.module("@/lib/platforms/providers/publishViaRegistry", () => ({
  refreshRegistryAccountToken: async (_account: unknown, options: unknown) => {
    registryRefreshOptions.push(options);
    return nextRegistryResult;
  },
}));

mock.module("@/actions/api/upstash", () => ({ redis: {} }));

const { refreshSocialAccountToken } = await import("./refreshSocialAccountToken");
const { buildTokenRefreshEvents, TOKEN_REFRESH_HORIZON_MS } = await import(
  "@/inngest/events/socialAccountTokenRefresh"
);

function readHandler(candidate: unknown): (input: unknown) => Promise<unknown> {
  if (typeof candidate !== "object" || candidate === null || !("handler" in candidate)) {
    throw new Error("createFunction mock not applied");
  }
  const handler: unknown = candidate.handler;
  if (typeof handler !== "function") throw new Error("captured handler is not a function");
  return (input: unknown) => Promise.resolve(handler(input));
}

const runRefresh = () =>
  readHandler(refreshSocialAccountToken)({
    event: { data: { social_account_id: "account-1" } },
    step: { run: async (_stepId: string, stepBody: () => Promise<unknown>) => stepBody() },
  });

const EXPIRED_AT = "2026-01-01T00:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

function buildExpiryInDays(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

beforeEach(() => {
  storedAccountRows = [{ id: "account-1", platform: "tiktok", is_available: true, token_expires_at: EXPIRED_AT }];
  nextTokenResult = { success: true, token: "token" };
  ensureValidTokenCalls = 0;
  ensureValidTokenOptions = undefined;
  nextRegistryResult = { success: true, accessToken: "token", reconnectWarning: null };
  registryRefreshOptions = [];
});

describe("refreshSocialAccountToken", () => {
  test("a refresh that may pass later fails the step so Inngest retries it", async () => {
    nextTokenResult = { success: false, error: "We could not refresh", failureReason: "transient" };
    await expect(runRefresh()).rejects.toThrow("tiktok account account-1 refresh failed (transient)");
  });

  test("a refused credential ends as needs_reconnect without a retry", async () => {
    nextTokenResult = { success: false, error: "Your tiktok account needs to be reconnected.", failureReason: "auth_expired" };
    expect(await runRefresh()).toEqual({
      outcome: "needs_reconnect",
      message: "Your tiktok account needs to be reconnected.",
    });
  });

  test("an account flagged unavailable or not yet expiring is left alone", async () => {
    storedAccountRows = [{ id: "account-1", platform: "tiktok", is_available: false, token_expires_at: EXPIRED_AT }];
    expect(await runRefresh()).toEqual({ outcome: "skipped", reason: "already_unavailable" });

    storedAccountRows = [{ id: "account-1", platform: "instagram", is_available: true, token_expires_at: buildExpiryInDays(8) }];
    expect(await runRefresh()).toEqual({ outcome: "not_due" });
    expect(ensureValidTokenCalls).toBe(0);
  });

  test("a token that still works but expires within the 7-day horizon is refreshed now", async () => {
    storedAccountRows = [{ id: "account-1", platform: "instagram", is_available: true, token_expires_at: buildExpiryInDays(3) }];
    expect(await runRefresh()).toEqual({ outcome: "refreshed" });
    expect(ensureValidTokenOptions).toEqual({ refreshIfExpiringWithinMs: TOKEN_REFRESH_HORIZON_MS });
  });
});

describe("refreshSocialAccountToken for registry platforms", () => {
  const THREADS_ROW: AccountRow = {
    id: "account-1",
    platform: "threads",
    is_available: true,
    token_expires_at: buildExpiryInDays(3),
  };

  test("a Threads token inside the 7-day horizon is renewed through the registry, not ensureValidToken", async () => {
    storedAccountRows = [THREADS_ROW];
    expect(await runRefresh()).toEqual({ outcome: "refreshed" });
    expect(registryRefreshOptions).toEqual([{ refreshIfExpiringWithinMs: TOKEN_REFRESH_HORIZON_MS }]);
    expect(ensureValidTokenCalls).toBe(0);
  });

  test("a renewed token whose rotated refresh token was not saved ends as needs_reconnect", async () => {
    storedAccountRows = [THREADS_ROW];
    nextRegistryResult = { success: true, accessToken: "token", reconnectWarning: "Please reconnect the account." };
    expect(await runRefresh()).toEqual({ outcome: "needs_reconnect", message: "Please reconnect the account." });
  });

  test("a registry refresh that may pass later fails the step, a refused one does not", async () => {
    storedAccountRows = [THREADS_ROW];
    nextRegistryResult = { success: false, message: "Threads answered 503", reason: "transient" };
    await expect(runRefresh()).rejects.toThrow("threads account account-1 refresh failed (transient)");

    nextRegistryResult = { success: false, message: "Threads refused the token", reason: "auth_expired" };
    expect(await runRefresh()).toEqual({ outcome: "needs_reconnect", message: "Threads refused the token" });
  });
});

describe("buildTokenRefreshEvents", () => {
  test("one event id per account and UTC day, so a same-day resend is dropped", () => {
    const [lateEvening] = buildTokenRefreshEvents({ socialAccountIds: ["account-1"], now: new Date("2026-11-20T23:59:59Z") });
    const [nextMorning] = buildTokenRefreshEvents({ socialAccountIds: ["account-1"], now: new Date("2026-11-21T00:00:01Z") });
    expect(lateEvening.id).toBe("token-refresh-account-1-2026-11-20");
    expect(nextMorning.id).toBe("token-refresh-account-1-2026-11-21");
    expect(lateEvening.data).toEqual({ social_account_id: "account-1" });
  });
});
