import { describe, expect, mock, test } from "bun:test";

import type { ProviderFetchFailure } from "./providerFetch";

mock.module("server-only", () => ({}));

const { classifyHttpAnswer, failProviderFetch } = await import("./publishFailure");

describe("classifyHttpAnswer", () => {
  test("a 5xx answer to the publishing request may hide a published post", () => {
    expect(
      classifyHttpAnswer({ platform: "mastodon", stage: "publish", httpStatus: 503, bodyText: "" }),
    ).toEqual({ reason: "transient", mayHavePublished: true });
  });

  test("a 5xx answer to a preparing request published nothing", () => {
    expect(
      classifyHttpAnswer({ platform: "mastodon", stage: "prepare", httpStatus: 503, bodyText: "" }),
    ).toEqual({ reason: "transient", mayHavePublished: false });
  });

  test("a refusal published nothing and keeps its retry reason", () => {
    expect(
      classifyHttpAnswer({ platform: "discord", stage: "publish", httpStatus: 429, bodyText: "{}" }),
    ).toEqual({ reason: "rate_limited", mayHavePublished: false });
    expect(
      classifyHttpAnswer({ platform: "devto", stage: "publish", httpStatus: 401, bodyText: "" }),
    ).toEqual({ reason: "auth_expired", mayHavePublished: false });
  });

  test("an unexpected 2xx answer to the publishing request is an unknown outcome", () => {
    expect(
      classifyHttpAnswer({ platform: "tumblr", stage: "publish", httpStatus: 204, bodyText: "" }),
    ).toEqual({ reason: "unknown", mayHavePublished: true });
  });
});

describe("failProviderFetch", () => {
  test("a request that never left keeps its reason and published nothing", () => {
    const failure = failProviderFetch({
      platform: "lemmy",
      stage: "publish",
      fetchFailure: {
        ok: false,
        kind: "not_sent",
        reason: "transient",
        message: "Provider host is not reachable or not permitted (dns_failure).",
      },
    });
    expect(failure.failure).toEqual({ reason: "transient", mayHavePublished: false });
  });

  test("a publishing request without an answer may have published", () => {
    const fetchFailure: ProviderFetchFailure = {
      ok: false,
      kind: "no_answer",
      message: "fetch failed (ETIMEDOUT)",
    };
    expect(
      failProviderFetch({ platform: "reddit", stage: "publish", fetchFailure }).failure,
    ).toEqual({ reason: "transient", mayHavePublished: true });
    expect(
      failProviderFetch({ platform: "reddit", stage: "prepare", fetchFailure }).failure,
    ).toEqual({ reason: "transient", mayHavePublished: false });
  });

  test("a redirect answer published nothing", () => {
    const failure = failProviderFetch({
      platform: "wordpress",
      stage: "publish",
      fetchFailure: { ok: false, kind: "redirected", status: 301, message: "redirected" },
    });
    expect(failure.failure).toEqual({ reason: "unknown", mayHavePublished: false });
  });
});
