import { afterEach, describe, expect, mock, setSystemTime, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  MAX_CACHED_SUBSCRIPTIONS,
  getCachedSubscription,
  invalidateCachedSubscription,
  setCachedSubscription,
} = await import("./subscriptionCache");

const ACTIVE_SUBSCRIPTION = { isActive: true, plan: null, priceId: null };
const CACHE_TTL_MS = 60_000;

function fillCache(principalIds: string[]): void {
  for (const principalId of principalIds) setCachedSubscription(principalId, ACTIVE_SUBSCRIPTION);
}

function buildPrincipalIds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => `${prefix}-${index}`);
}

afterEach(() => {
  setSystemTime();
  for (const principalId of [
    ...buildPrincipalIds("principal", MAX_CACHED_SUBSCRIPTIONS + 1),
    ...buildPrincipalIds("stale", 2),
    "fresh",
  ]) {
    invalidateCachedSubscription(principalId);
  }
});

describe("subscription cache bound", () => {
  test("adding past the cap evicts the oldest entry and keeps the rest", () => {
    const principalIds = buildPrincipalIds("principal", MAX_CACHED_SUBSCRIPTIONS + 1);

    fillCache(principalIds);

    expect(getCachedSubscription("principal-0")).toBeNull();
    expect(getCachedSubscription("principal-1")).not.toBeNull();
    expect(getCachedSubscription(`principal-${MAX_CACHED_SUBSCRIPTIONS}`)).not.toBeNull();
  });

  test("refreshing an entry makes it the newest, so the next eviction skips it", () => {
    const principalIds = buildPrincipalIds("principal", MAX_CACHED_SUBSCRIPTIONS);
    fillCache(principalIds);

    setCachedSubscription("principal-0", ACTIVE_SUBSCRIPTION);
    setCachedSubscription(`principal-${MAX_CACHED_SUBSCRIPTIONS}`, ACTIVE_SUBSCRIPTION);

    expect(getCachedSubscription("principal-0")).not.toBeNull();
    expect(getCachedSubscription("principal-1")).toBeNull();
  });

  test("an entry still expires after the TTL", () => {
    setSystemTime(new Date("2026-11-21T00:00:00.000Z"));
    setCachedSubscription("fresh", ACTIVE_SUBSCRIPTION);

    setSystemTime(new Date(Date.parse("2026-11-21T00:00:00.000Z") + CACHE_TTL_MS + 1));

    expect(getCachedSubscription("fresh")).toBeNull();
  });

  test("expired entries at the front are dropped on the next write, below the cap", () => {
    setSystemTime(new Date("2026-11-21T00:00:00.000Z"));
    fillCache(buildPrincipalIds("stale", 2));

    setSystemTime(new Date(Date.parse("2026-11-21T00:00:00.000Z") + CACHE_TTL_MS + 1));
    setCachedSubscription("fresh", ACTIVE_SUBSCRIPTION);
    setSystemTime(new Date("2026-11-21T00:00:00.000Z"));

    expect(getCachedSubscription("stale-0")).toBeNull();
    expect(getCachedSubscription("stale-1")).toBeNull();
    expect(getCachedSubscription("fresh")).not.toBeNull();
  });
});
