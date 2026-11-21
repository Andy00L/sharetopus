import "server-only";

export type PollOutcome<TValue> =
  | { status: "found"; value: TValue }
  | { status: "timed_out"; lastError: unknown };

export async function pollUntilDeadline<TValue>(params: {
  timeoutMs: number;
  intervalMs: number;
  requestTimeoutMs: number;
  readOnce: (abortSignal: AbortSignal) => Promise<TValue | null>;
}): Promise<PollOutcome<TValue>> {
  const deadlineMs = Date.now() + params.timeoutMs;
  let lastError: unknown = null;

  for (;;) {
    try {
      const value = await params.readOnce(AbortSignal.timeout(params.requestTimeoutMs));
      if (value !== null) return { status: "found", value };
      lastError = null;
    } catch (error) {
      lastError = error;
    }

    if (Date.now() + params.intervalMs > deadlineMs) {
      return { status: "timed_out", lastError };
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, params.intervalMs));
  }
}
