import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

mock.module("server-only", () => ({}));

type PricingRow = { usdc_price: number; effective_until: string | null };

const START_MS = Date.parse("2026-11-21T12:00:00.000Z");
const MINUTE_MS = 60_000;

let databaseReads = 0;
let activeRows: PricingRow[] = [];

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async () => {
    databaseReads += 1;
    return { data: activeRows, error: null };
  },
}));

const { readActionPrice } = await import("./readActionPrice");

beforeEach(() => {
  databaseReads = 0;
  setSystemTime(new Date(START_MS));
});

afterEach(() => {
  setSystemTime();
});

describe("readActionPrice cache", () => {
  test("a price read again within 10 minutes costs no database read, and is read again after", async () => {
    activeRows = [{ usdc_price: 0.01, effective_until: null }];

    await readActionPrice("list_history");
    setSystemTime(new Date(START_MS + 9 * MINUTE_MS));
    const cachedRead = await readActionPrice("list_history");
    setSystemTime(new Date(START_MS + 11 * MINUTE_MS));
    await readActionPrice("list_history");

    expect(cachedRead).toEqual({ ok: true, usdcPrice: 0.01 });
    expect(databaseReads).toBe(2);
  });

  test("a price whose window closes before the cache lifetime is not served past the close", async () => {
    activeRows = [{ usdc_price: 0.5, effective_until: new Date(START_MS + 2 * MINUTE_MS).toISOString() }];
    await readActionPrice("connect_account");

    activeRows = [];
    setSystemTime(new Date(START_MS + 3 * MINUTE_MS));
    const afterClose = await readActionPrice("connect_account");

    expect(afterClose).toEqual({ ok: false, message: 'No active pricing for action "connect_account".' });
    expect(databaseReads).toBe(2);
  });
});
