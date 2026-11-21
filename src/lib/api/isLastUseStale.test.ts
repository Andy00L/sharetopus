import { describe, expect, test } from "bun:test";

import { isLastUseStale, LAST_USED_WRITE_INTERVAL_MS } from "./isLastUseStale";

const NOW_MS = Date.parse("2026-11-19T12:00:00.000Z");

function isoAgo(elapsedMs: number): string {
  return new Date(NOW_MS - elapsedMs).toISOString();
}

describe("isLastUseStale", () => {
  test("a key never used gets its first write", () => {
    expect(isLastUseStale(null, NOW_MS)).toBe(true);
  });

  test("a key used inside the interval skips the write", () => {
    expect(isLastUseStale(isoAgo(LAST_USED_WRITE_INTERVAL_MS - 1), NOW_MS)).toBe(false);
  });

  test("a key used exactly one interval ago is written again", () => {
    expect(isLastUseStale(isoAgo(LAST_USED_WRITE_INTERVAL_MS), NOW_MS)).toBe(true);
  });

  test("an unparseable stored timestamp is overwritten instead of blocking writes forever", () => {
    expect(isLastUseStale("not a timestamp", NOW_MS)).toBe(true);
  });

  test("the microsecond timestamp the timestamptz column returns is parsed", () => {
    expect(isLastUseStale("2026-11-19T11:58:00.123456+00:00", NOW_MS)).toBe(false);
  });
});
