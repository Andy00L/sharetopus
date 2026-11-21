import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

mock.module("server-only", () => ({}));

const { RUNTIME } = await import("./runtimeConfig");
const { PLATFORM_MEDIA_UPLOAD_TIMEOUT_MS } = await import(
  "@/lib/api/_shared/platformFetchTimeouts"
);

const INNGEST_ROUTE_PATH = join(import.meta.dir, "../../app/api/inngest/route.ts");
const MAX_DURATION_EXPORT_PATTERN = /export const maxDuration = (\d+);/;

function readInngestRouteMaxDurationS(): number | null {
  const routeSource = readFileSync(INNGEST_ROUTE_PATH, "utf8");
  const maxDurationMatch = MAX_DURATION_EXPORT_PATTERN.exec(routeSource);
  return maxDurationMatch ? Number(maxDurationMatch[1]) : null;
}

describe("RUNTIME", () => {
  test("the Inngest route's maxDuration literal equals RUNTIME.maxDurationS", () => {
    expect(readInngestRouteMaxDurationS()).toBe(RUNTIME.maxDurationS);
  });

  test("a step that starts in a request keeps time for the longest platform upload", () => {
    expect(RUNTIME.minStepBudgetS).toBeLessThan(RUNTIME.maxDurationS);
    expect(RUNTIME.minStepBudgetS * 1000).toBeGreaterThanOrEqual(
      PLATFORM_MEDIA_UPLOAD_TIMEOUT_MS,
    );
  });
});
