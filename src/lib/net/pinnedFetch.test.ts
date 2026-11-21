import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { acquirePinnedDispatcher, buildPinnedLookup } = await import("./pinnedFetch");

type LookupAnswer = { address: unknown; family: number | undefined };

function runLookup(
  lookup: ReturnType<typeof buildPinnedLookup>,
  options: { all?: boolean },
): LookupAnswer {
  let answer: LookupAnswer = { address: null, family: undefined };
  lookup("pinned.example.test", options, (_error, address, family) => {
    answer = { address, family };
  });
  return answer;
}

describe("buildPinnedLookup", () => {
  test("answers an all:true lookup with an address list, as autoSelectFamily requires", () => {
    const lookup = buildPinnedLookup({ address: "93.184.216.34", family: 4 });
    expect(runLookup(lookup, { all: true }).address).toEqual([
      { address: "93.184.216.34", family: 4 },
    ]);
  });

  test("answers a single lookup with the pinned address and family", () => {
    const lookup = buildPinnedLookup({ address: "2606:2800:220:1::1", family: 6 });
    expect(runLookup(lookup, {})).toEqual({ address: "2606:2800:220:1::1", family: 6 });
  });
});

describe("acquirePinnedDispatcher", () => {
  test("reuses one dispatcher per pinned address", () => {
    const first = acquirePinnedDispatcher([{ address: "198.51.100.1", family: 4 }]);
    const again = acquirePinnedDispatcher([
      { address: "198.51.100.1", family: 4 },
      { address: "198.51.100.2", family: 4 },
    ]);
    const other = acquirePinnedDispatcher([{ address: "198.51.100.2", family: 4 }]);
    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });

  test("drops the least recently used address past the cache limit", () => {
    const kept = acquirePinnedDispatcher([{ address: "203.0.113.1", family: 4 }]);
    const evicted = acquirePinnedDispatcher([{ address: "203.0.113.2", family: 4 }]);
    acquirePinnedDispatcher([{ address: "203.0.113.1", family: 4 }]);
    for (let fillerIndex = 0; fillerIndex < 63; fillerIndex++) {
      acquirePinnedDispatcher([{ address: `192.0.2.${fillerIndex + 1}`, family: 4 }]);
    }
    expect(acquirePinnedDispatcher([{ address: "203.0.113.1", family: 4 }])).toBe(kept);
    expect(acquirePinnedDispatcher([{ address: "203.0.113.2", family: 4 }])).not.toBe(evicted);
  });
});
