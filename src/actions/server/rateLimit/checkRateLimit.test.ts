import { beforeEach, describe, expect, mock, test } from "bun:test";

type LimiterConfig = { prefix: string; limiter: { limit: number; window: string } };

const builtLimiters: LimiterConfig[] = [];
const limitedIdentifiers: string[] = [];

mock.module("server-only", () => ({}));
mock.module("@/actions/api/upstash", () => ({ redis: {} }));
mock.module("@vercel/functions", () => ({ waitUntil: () => {} }));
mock.module("next/headers", () => ({ headers: async () => new Headers() }));
mock.module("@/lib/net/clientIp", () => ({ resolveClientIp: () => "203.0.113.7" }));
mock.module("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow(limit: number, window: string) {
      return { limit, window };
    }
    constructor(config: LimiterConfig) {
      builtLimiters.push(config);
    }
    async limit(identifier: string) {
      limitedIdentifiers.push(identifier);
      return { success: true, reset: 0, pending: Promise.resolve() };
    }
  },
}));

const { checkRateLimit } = await import("./checkRateLimit");

beforeEach(() => {
  builtLimiters.length = 0;
  limitedIdentifiers.length = 0;
});

describe("checkRateLimit", () => {
  test("builds the limiter from the named rule and keys it by operation", async () => {
    const result = await checkRateLimit({
      operation: "test_named_rule",
      identifier: "user_a",
      rule: { limit: 15, windowSeconds: 30 },
    });

    expect(result).toEqual({ success: true });
    expect(builtLimiters).toHaveLength(1);
    expect(builtLimiters[0].prefix).toBe("ratelimit_test_named_rule");
    expect(builtLimiters[0].limiter).toEqual({ limit: 15, window: "30 s" });
    expect(limitedIdentifiers).toEqual(["user_a"]);
  });

  test("falls back to the client IP when no identifier is given", async () => {
    await checkRateLimit({
      operation: "test_ip_fallback",
      identifier: null,
      rule: { limit: 5, windowSeconds: 60 },
    });

    expect(limitedIdentifiers).toEqual(["203.0.113.7"]);
  });
});
