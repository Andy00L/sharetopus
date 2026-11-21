import { afterEach, describe, expect, jest, mock, test } from "bun:test";
import { NetworkError } from "@coinbase/cdp-sdk";

mock.module("server-only", () => ({}));

const { sendThroughCdp } = await import("./cdpClient");

const REFUND_TX_HASH = "0x5f1c6b3a9e2d4f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8";
const OPERATION_NAME = "CDP refund send on Base";

function buildCdpApiError(statusCode: number, errorType: string): Error {
  return Object.assign(new Error(`CDP answered ${statusCode}`), { name: "APIError", statusCode, errorType });
}

function sendFailingWith(error: Error) {
  return sendThroughCdp({ send: () => Promise.reject(error), operationName: OPERATION_NAME });
}

afterEach(() => {
  jest.useRealTimers();
});

describe("sendThroughCdp", () => {
  test("a send CDP answers returns its transaction hash", async () => {
    const sendResult = await sendThroughCdp({
      send: () => Promise.resolve(REFUND_TX_HASH),
      operationName: OPERATION_NAME,
    });

    expect(sendResult).toEqual({ status: "sent", txHash: REFUND_TX_HASH });
  });

  test("a send CDP never answers is reported as an unknown outcome after 15 seconds, not as nothing sent", async () => {
    jest.useFakeTimers();
    const pendingSend = sendThroughCdp({
      send: () => new Promise<string>(() => {}),
      operationName: OPERATION_NAME,
    });

    jest.advanceTimersByTime(15_000);

    expect(await pendingSend).toEqual({
      status: "outcome_unknown",
      txHash: null,
      message: `${OPERATION_NAME} did not answer within 15000 ms.`,
    });
  });

  test("a request that got no response from CDP has an unknown outcome", async () => {
    const sendResult = await sendFailingWith(
      new NetworkError("network_timeout", "Request timed out. Please try again.", { code: "ECONNABORTED" }),
    );

    expect(sendResult).toEqual({
      status: "outcome_unknown",
      txHash: null,
      message: "Request timed out. Please try again.",
    });
  });

  test("a CDP server error has an unknown outcome", async () => {
    expect(await sendFailingWith(buildCdpApiError(503, "service_unavailable"))).toMatchObject({
      status: "outcome_unknown",
    });
  });

  test("a CDP refusal (4xx) means nothing was sent", async () => {
    expect(await sendFailingWith(buildCdpApiError(400, "invalid_request"))).toMatchObject({
      status: "not_sent",
    });
  });

  test("a 4xx about our idempotency key has an unknown outcome, since an earlier request with that key exists", async () => {
    expect(await sendFailingWith(buildCdpApiError(409, "idempotency_error"))).toMatchObject({
      status: "outcome_unknown",
    });
  });
});
