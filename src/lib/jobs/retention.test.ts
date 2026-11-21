import { describe, expect, test } from "bun:test";

import { computeRetentionCutoff, RETENTION_DAYS } from "./retention";

describe("computeRetentionCutoff", () => {
  test("cuts off exactly RETENTION_DAYS before now", () => {
    const now = new Date("2026-11-20T12:00:00.000Z");
    const { cutoffIso } = computeRetentionCutoff(now);
    expect(now.getTime() - Date.parse(cutoffIso)).toBe(RETENTION_DAYS * 24 * 60 * 60 * 1000);
  });

  test("cutoffMonth is the UTC month of the cutoff, so month <= cutoffMonth keeps every expired row", () => {
    const lastInstantOfJuly = new Date(Date.parse("2026-07-31T23:59:59.999Z") + RETENTION_DAYS * 24 * 60 * 60 * 1000);
    expect(computeRetentionCutoff(lastInstantOfJuly)).toEqual({
      cutoffIso: "2026-07-31T23:59:59.999Z",
      cutoffMonth: "2026-07-01",
    });

    const firstInstantOfAugust = new Date(Date.parse("2026-08-01T00:00:00.000Z") + RETENTION_DAYS * 24 * 60 * 60 * 1000);
    expect(computeRetentionCutoff(firstInstantOfAugust).cutoffMonth).toBe("2026-08-01");
  });
});
