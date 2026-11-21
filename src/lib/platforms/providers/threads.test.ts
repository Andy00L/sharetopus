import { describe, expect, mock, spyOn, test } from "bun:test";

import type { ProviderFetchResult } from "./_shared/providerFetch";
import type { ProviderPublishInput } from "./types";

mock.module("server-only", () => ({}));

let fakeNowMs = 1_000_000;
spyOn(Date, "now").mockImplementation(() => fakeNowMs);
mock.module("node:timers/promises", () => ({
  setTimeout: async (delayMs: number) => {
    fakeNowMs += delayMs;
  },
}));

const realProviderFetch = await import("./_shared/providerFetch");
const requestedUrls: string[] = [];
let nextAnswer: ProviderFetchResult = { ok: true, status: 200, bodyText: "{}", headers: {} };
let queuedAnswers: ProviderFetchResult[] = [];
mock.module("./_shared/providerFetch", () => ({
  ...realProviderFetch,
  providerFetch: async (requestUrl: string) => {
    requestedUrls.push(requestUrl);
    return queuedAnswers.shift() ?? nextAnswer;
  },
}));

const { threadsBehavior } = await import("./threads");

function answerJson(body: Record<string, unknown>): ProviderFetchResult {
  return { ok: true, status: 200, bodyText: JSON.stringify(body), headers: {} };
}

function requestedPaths(): string[] {
  return requestedUrls.map((requestUrl) => new URL(requestUrl).pathname);
}

const VIDEO_POST: ProviderPublishInput = {
  accessToken: "token",
  config: { userId: "1789" },
  accountIdentifier: "1789",
  title: "",
  body: "Launch day",
  postType: "video",
  mediaUrl: "https://storage.test/clip.mp4",
  fileName: "clip.mp4",
  mediaMimeType: "video/mp4",
  options: {},
  idempotencyKey: "post-1",
};

function refreshWith(accessToken: string | null) {
  const refresh = threadsBehavior.refresh;
  if (!refresh) throw new Error("Threads declares no refresh");
  return refresh({ accessToken, refreshToken: null, config: { userId: "1789" } });
}

describe("Threads refresh", () => {
  test("renews the long-lived token with th_refresh_token and keeps its new lifetime", async () => {
    requestedUrls.length = 0;
    nextAnswer = {
      ok: true,
      status: 200,
      bodyText: JSON.stringify({
        access_token: "renewed-token",
        token_type: "bearer",
        expires_in: 5183944,
      }),
      headers: {},
    };
    const refreshed = await refreshWith("long-lived token");
    expect(requestedUrls).toEqual([
      "https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=long-lived%20token",
    ]);
    expect(refreshed).toEqual({
      ok: true,
      accessToken: "renewed-token",
      rotatedRefreshToken: null,
      expiresIn: 5183944,
    });
  });

  test("an expired or revoked token asks for a reconnect", async () => {
    nextAnswer = {
      ok: true,
      status: 400,
      bodyText: JSON.stringify({ error: { code: 190, message: "Error validating access token" } }),
      headers: {},
    };
    const refused = await refreshWith("long-lived token");
    expect(refused.ok ? null : refused.reason).toBe("auth_expired");
  });

  test("no stored token means a reconnect, without a request", async () => {
    requestedUrls.length = 0;
    const refreshed = await refreshWith(null);
    expect(refreshed.ok ? null : refreshed.reason).toBe("auth_expired");
    expect(requestedUrls).toEqual([]);
  });
});

describe("Threads publish", () => {
  test("a video waits for its container to finish, then publishes once", async () => {
    requestedUrls.length = 0;
    queuedAnswers = [
      answerJson({ id: "container-1" }),
      answerJson({ status: "IN_PROGRESS", id: "container-1" }),
      answerJson({ status: "FINISHED", id: "container-1" }),
      answerJson({ id: "media-1" }),
    ];
    const published = await threadsBehavior.publish(VIDEO_POST);
    expect(published).toEqual({ ok: true, postId: "media-1", postUrl: null });
    expect(requestedPaths()).toEqual([
      "/v1.0/1789/threads",
      "/v1.0/container-1",
      "/v1.0/container-1",
      "/v1.0/1789/threads_publish",
    ]);
  });

  test("a container Threads could not download fails as retryable without publishing", async () => {
    requestedUrls.length = 0;
    queuedAnswers = [
      answerJson({ id: "container-2" }),
      answerJson({ status: "ERROR", error_message: "FAILED_DOWNLOADING_VIDEO" }),
    ];
    const published = await threadsBehavior.publish(VIDEO_POST);
    expect(published.ok ? null : published.failure).toEqual({
      reason: "transient",
      mayHavePublished: false,
    });
    expect(requestedPaths()).not.toContain("/v1.0/1789/threads_publish");
  });

  test("the wait gives up within its deadline and never publishes", async () => {
    requestedUrls.length = 0;
    const startedAtMs = fakeNowMs;
    queuedAnswers = [answerJson({ id: "container-3" })];
    nextAnswer = answerJson({ status: "IN_PROGRESS" });
    const published = await threadsBehavior.publish(VIDEO_POST);
    expect(published.ok ? null : published.failure).toEqual({
      reason: "transient",
      mayHavePublished: false,
    });
    expect(fakeNowMs - startedAtMs).toBeLessThanOrEqual(120_000);
    expect(requestedPaths()).not.toContain("/v1.0/1789/threads_publish");
  });

  test("a text post publishes without a status check", async () => {
    requestedUrls.length = 0;
    queuedAnswers = [answerJson({ id: "container-4" }), answerJson({ id: "media-4" })];
    const published = await threadsBehavior.publish({
      ...VIDEO_POST,
      postType: "text",
      mediaUrl: null,
    });
    expect(published.ok).toBe(true);
    expect(requestedPaths()).toEqual(["/v1.0/1789/threads", "/v1.0/1789/threads_publish"]);
  });
});
