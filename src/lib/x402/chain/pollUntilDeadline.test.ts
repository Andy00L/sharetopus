import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { pollUntilDeadline } = await import("./pollUntilDeadline");

const POLL_INTERVAL_MS = 5;

describe("pollUntilDeadline", () => {
  test("a read that throws does not end the poll; a later read's value is returned", async () => {
    const answers: Array<Error | string | null> = [new Error("rpc reset"), null, "confirmed"];
    let readCount = 0;

    const outcome = await pollUntilDeadline({
      timeoutMs: 1_000,
      intervalMs: POLL_INTERVAL_MS,
      requestTimeoutMs: 100,
      readOnce: async () => {
        const answer = answers[readCount] ?? null;
        readCount += 1;
        if (answer instanceof Error) throw answer;
        return answer;
      },
    });

    expect(outcome).toEqual({ status: "found", value: "confirmed" });
    expect(readCount).toBe(3);
  });

  test("a timeout of 0 makes exactly one read and reports what it threw", async () => {
    let readCount = 0;
    const rpcError = new Error("rpc down");

    const outcome = await pollUntilDeadline<string>({
      timeoutMs: 0,
      intervalMs: POLL_INTERVAL_MS,
      requestTimeoutMs: 100,
      readOnce: async () => {
        readCount += 1;
        throw rpcError;
      },
    });

    expect(outcome).toEqual({ status: "timed_out", lastError: rpcError });
    expect(readCount).toBe(1);
  });

  test("a poll whose last read answered 'not yet' times out with no error", async () => {
    const outcome = await pollUntilDeadline<string>({
      timeoutMs: 20,
      intervalMs: POLL_INTERVAL_MS,
      requestTimeoutMs: 100,
      readOnce: async () => null,
    });

    expect(outcome).toEqual({ status: "timed_out", lastError: null });
  });

  test("each read gets an abort signal that fires after the per-request timeout", async () => {
    const outcome = await pollUntilDeadline<string>({
      timeoutMs: 0,
      intervalMs: POLL_INTERVAL_MS,
      requestTimeoutMs: 10,
      readOnce: (abortSignal) =>
        new Promise((resolveNever, rejectRead) => {
          abortSignal.addEventListener("abort", () => rejectRead(abortSignal.reason));
        }),
    });

    expect(outcome.status).toBe("timed_out");
    expect(outcome.status === "timed_out" && outcome.lastError).toMatchObject({ name: "TimeoutError" });
  });
});
