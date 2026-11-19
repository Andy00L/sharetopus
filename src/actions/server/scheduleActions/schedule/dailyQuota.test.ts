import { describe, expect, test } from "bun:test";

import { countPostsByPlatform, findDailyQuotaViolation } from "./dailyQuota";

describe("findDailyQuotaViolation", () => {
  test("a batch that lands exactly on the cap fits", () => {
    const violation = findDailyQuotaViolation({
      addedCountByPlatform: new Map([["tiktok", 2]]),
      existingCountByPlatform: new Map([["tiktok", 8]]),
      dailyCapByPlatform: new Map([["tiktok", 10]]),
      defaultDailyCap: 50,
    });
    expect(violation).toBeNull();
  });

  test("one post over the cap is refused with the counts that broke it", () => {
    const violation = findDailyQuotaViolation({
      addedCountByPlatform: new Map([["tiktok", 3]]),
      existingCountByPlatform: new Map([["tiktok", 8]]),
      dailyCapByPlatform: new Map([["tiktok", 10]]),
      defaultDailyCap: 50,
    });
    expect(violation).toEqual({
      platform: "tiktok",
      existingCount: 8,
      addedCount: 3,
      dailyCap: 10,
    });
  });

  test("a platform with no quota row and no due posts uses the default cap", () => {
    const fits = findDailyQuotaViolation({
      addedCountByPlatform: new Map([["bluesky", 50]]),
      existingCountByPlatform: new Map(),
      dailyCapByPlatform: new Map(),
      defaultDailyCap: 50,
    });
    const overflows = findDailyQuotaViolation({
      addedCountByPlatform: new Map([["bluesky", 51]]),
      existingCountByPlatform: new Map(),
      dailyCapByPlatform: new Map(),
      defaultDailyCap: 50,
    });
    expect(fits).toBeNull();
    expect(overflows?.dailyCap).toBe(50);
  });

  test("the first platform in batch order is the one reported", () => {
    const violation = findDailyQuotaViolation({
      addedCountByPlatform: countPostsByPlatform([
        { platform: "x" },
        { platform: "linkedin" },
        { platform: "x" },
      ]),
      existingCountByPlatform: new Map([
        ["x", 1],
        ["linkedin", 1],
      ]),
      dailyCapByPlatform: new Map([
        ["x", 2],
        ["linkedin", 1],
      ]),
      defaultDailyCap: 50,
    });
    expect(violation?.platform).toBe("x");
    expect(violation?.addedCount).toBe(2);
  });
});
