import { describe, expect, test } from "bun:test";

import { describeNetworkError } from "./describeNetworkError";

describe("describeNetworkError", () => {
  test("appends the cause code undici hides behind fetch failed", () => {
    const cause = Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" });
    expect(describeNetworkError(new Error("fetch failed", { cause }))).toBe(
      "fetch failed (ECONNREFUSED)",
    );
  });

  test("falls back to the cause message when it carries no code", () => {
    const cause = new Error("certificate has expired");
    expect(describeNetworkError(new Error("fetch failed", { cause }))).toBe(
      "fetch failed (certificate has expired)",
    );
  });

  test("keeps a timeout message as is, so the classifier still reads timeout", () => {
    const timeoutError = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    expect(describeNetworkError(timeoutError)).toBe("The operation was aborted due to timeout");
  });
});
