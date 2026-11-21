import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { TIMEOUT_ERROR_NAME, withTimeout } = await import("./withTimeout");

function resolveAfter<TValue>(delayMs: number, value: TValue): Promise<TValue> {
  return new Promise((resolveValue) => setTimeout(() => resolveValue(value), delayMs));
}

describe("withTimeout", () => {
  test("an operation that answers in time returns its value", async () => {
    await expect(withTimeout(resolveAfter(5, "sent"), 200, "refund send")).resolves.toBe("sent");
  });

  test("an operation that does not answer in time rejects with the timeout error name settlePayment classifies", async () => {
    const timedOut = withTimeout(resolveAfter(200, "late"), 10, "Facilitator settle");

    await expect(timedOut).rejects.toMatchObject({
      name: TIMEOUT_ERROR_NAME,
      message: "Facilitator settle did not answer within 10 ms.",
    });
  });

  test("an operation that fails in time rejects with its own error", async () => {
    const failed = withTimeout(Promise.reject(new Error("rpc down")), 200, "refund send");

    await expect(failed).rejects.toThrow("rpc down");
  });
});
