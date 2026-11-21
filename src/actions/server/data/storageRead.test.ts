import { describe, expect, test } from "bun:test";

import { classifyStorageReadError, toPublishFailureReason } from "./storageRead";

describe("classifyStorageReadError", () => {
  test("a missing object is not_found whether storage answers HTTP 404 or 400 with statusCode 404", () => {
    expect(classifyStorageReadError({ status: 404, statusCode: "404" })).toBe("not_found");
    expect(classifyStorageReadError({ status: 400, statusCode: "404" })).toBe("not_found");
    expect(classifyStorageReadError({ status: 404, statusCode: "NoSuchKey" })).toBe("not_found");
  });

  test("an outage, a refusal or a network failure is unavailable, so the worker retries it", () => {
    expect(classifyStorageReadError({ status: 503, statusCode: "503" })).toBe("unavailable");
    expect(classifyStorageReadError({ status: 400, statusCode: "InvalidKey" })).toBe("unavailable");
    expect(classifyStorageReadError({ status: 403, statusCode: "403" })).toBe("unavailable");
    expect(classifyStorageReadError({ status: undefined, statusCode: undefined })).toBe("unavailable");
  });

  test("a missing file is a final input refusal, an outage a retryable one", () => {
    expect(toPublishFailureReason("not_found")).toBe("invalid_input");
    expect(toPublishFailureReason("unavailable")).toBe("transient");
  });
});
