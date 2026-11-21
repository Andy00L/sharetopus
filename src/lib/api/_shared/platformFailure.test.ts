import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { buildHttpFailure, buildNetworkFailure, classifyPlatformHttpFailure } =
  await import("./platformFailure");

function graphErrorBody(graphCode: number, message: string): string {
  return JSON.stringify({ error: { message, type: "OAuthException", code: graphCode } });
}

describe("classifyPlatformHttpFailure", () => {
  test("Graph answers every error with 400, so the code decides the reason", () => {
    expect(
      classifyPlatformHttpFailure({
        platform: "facebook",
        httpStatus: 400,
        responseText: graphErrorBody(190, "Error validating access token"),
      }).reason,
    ).toBe("auth_expired");
    expect(
      classifyPlatformHttpFailure({
        platform: "instagram",
        httpStatus: 400,
        responseText: graphErrorBody(80002, "Too many calls"),
      }).reason,
    ).toBe("rate_limited");
    expect(
      classifyPlatformHttpFailure({
        platform: "facebook",
        httpStatus: 400,
        responseText: graphErrorBody(506, "Duplicate status message"),
      }).reason,
    ).toBe("policy_rejected");
    expect(
      classifyPlatformHttpFailure({
        platform: "facebook",
        httpStatus: 400,
        responseText: graphErrorBody(250, "Requires pages_manage_posts"),
      }).reason,
    ).toBe("auth_expired");
  });

  test("an unknown Graph code falls back to the HTTP status", () => {
    expect(
      classifyPlatformHttpFailure({
        platform: "facebook",
        httpStatus: 400,
        responseText: graphErrorBody(100, "Invalid parameter"),
      }),
    ).toEqual({ reason: "invalid_input", platformDetail: "code 100: Invalid parameter" });
  });

  test("Graph's is_transient flag marks an otherwise unknown code transient", () => {
    expect(
      classifyPlatformHttpFailure({
        platform: "instagram",
        httpStatus: 400,
        responseText: JSON.stringify({ error: { code: 9004, is_transient: true } }),
      }).reason,
    ).toBe("transient");
  });

  test("TikTok's daily post cap is a rate limit even though it answers 403", () => {
    expect(
      classifyPlatformHttpFailure({
        platform: "tiktok",
        httpStatus: 403,
        responseText: JSON.stringify({
          error: { code: "spam_risk_too_many_posts", message: "cap reached" },
        }),
      }),
    ).toEqual({
      reason: "rate_limited",
      platformDetail: "spam_risk_too_many_posts: cap reached",
    });
  });

  test("a YouTube 403 is a rate limit only when the error reason says quota", () => {
    const quotaBody = JSON.stringify({
      error: { message: "Quota exceeded", errors: [{ reason: "quotaExceeded" }] },
    });
    const forbiddenBody = JSON.stringify({
      error: { message: "Forbidden", errors: [{ reason: "forbidden" }] },
    });
    expect(
      classifyPlatformHttpFailure({ platform: "youtube", httpStatus: 403, responseText: quotaBody })
        .reason,
    ).toBe("rate_limited");
    expect(
      classifyPlatformHttpFailure({
        platform: "youtube",
        httpStatus: 403,
        responseText: forbiddenBody,
      }).reason,
    ).toBe("policy_rejected");
  });

  test("a body that is not JSON keeps the status reason", () => {
    expect(
      classifyPlatformHttpFailure({
        platform: "linkedin",
        httpStatus: 502,
        responseText: "<html>Bad Gateway</html>",
      }),
    ).toEqual({ reason: "transient", platformDetail: null });
  });
});

describe("buildHttpFailure", () => {
  test("only a 5xx answer to the publishing request may hide a published post", () => {
    const publishServerError = buildHttpFailure({
      platform: "x",
      action: "X tweet creation",
      httpStatus: 503,
      responseText: "",
      isPublishRequest: true,
    });
    const uploadServerError = buildHttpFailure({
      platform: "x",
      action: "X media upload initialization",
      httpStatus: 503,
      responseText: "",
      isPublishRequest: false,
    });
    const publishRateLimit = buildHttpFailure({
      platform: "x",
      action: "X tweet creation",
      httpStatus: 429,
      responseText: JSON.stringify({ title: "Too Many Requests" }),
      isPublishRequest: true,
    });
    expect(publishServerError.failure).toEqual({ reason: "transient", mayHavePublished: true });
    expect(uploadServerError.failure).toEqual({ reason: "transient", mayHavePublished: false });
    expect(publishRateLimit.failure).toEqual({ reason: "rate_limited", mayHavePublished: false });
    expect(publishRateLimit.error).toBe("X tweet creation failed (429): Too Many Requests");
  });

  test("a large HTML error body is not stored whole", () => {
    const htmlBody = `<html>${"x".repeat(10_000)}</html>`;
    const failure = buildHttpFailure({
      platform: "pinterest",
      action: "Pinterest pin creation",
      httpStatus: 500,
      responseText: htmlBody,
      isPublishRequest: true,
    });
    expect(failure.details).toEqual({ rawError: htmlBody.slice(0, 2_000) });
  });
});

describe("buildNetworkFailure", () => {
  test("a timeout on the publishing request may have published", () => {
    const timeoutError = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    expect(
      buildNetworkFailure({
        action: "Facebook publish",
        requestError: timeoutError,
        isPublishRequest: true,
      }).failure,
    ).toEqual({ reason: "transient", mayHavePublished: true });
  });
});
