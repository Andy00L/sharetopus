import "server-only";

/** The DOMException name AbortSignal.timeout() rejects with. */
export const TIMEOUT_ERROR_NAME = "TimeoutError";

/**
 * For SDK calls that accept no AbortSignal (@x402/core HTTPFacilitatorClient,
 * @coinbase/cdp-sdk): the request keeps running after the timeout, so a
 * timed-out call has an unknown outcome.
 */
export function withTimeout<TValue>(
  operation: Promise<TValue>,
  timeoutMs: number,
  operationName: string,
): Promise<TValue> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutRejection = new Promise<never>((resolveNever, rejectTimeout) => {
    timeoutHandle = setTimeout(() => {
      const timeoutError = new Error(`${operationName} did not answer within ${timeoutMs} ms.`);
      timeoutError.name = TIMEOUT_ERROR_NAME;
      rejectTimeout(timeoutError);
    }, timeoutMs);
  });
  return Promise.race([operation, timeoutRejection]).finally(() => clearTimeout(timeoutHandle));
}
