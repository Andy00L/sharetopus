import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { usdcToAtomic } = await import("./usdcAmount");

describe("usdcToAtomic", () => {
  test("converts a price to atomic units at the token's decimals", () => {
    expect(usdcToAtomic(0.25, 6)).toEqual({ ok: true, atomicAmount: BigInt(250_000) });
    expect(usdcToAtomic(100, 6)).toEqual({ ok: true, atomicAmount: BigInt(100_000_000) });
  });

  test("refuses amounts that are not positive and finite instead of returning zero", () => {
    for (const invalidAmount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e21]) {
      expect(usdcToAtomic(invalidAmount, 6).ok).toBe(false);
    }
  });

  test("refuses a positive amount that rounds to zero atomic units", () => {
    expect(usdcToAtomic(0.0000001, 6)).toEqual({
      ok: false,
      message: "1e-7 USDC rounds to zero at 6 decimals.",
    });
  });
});
