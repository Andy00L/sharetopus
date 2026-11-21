import { describe, expect, mock, test } from "bun:test";

import type { ProviderFetchResult } from "./_shared/providerFetch";

mock.module("server-only", () => ({}));

const realProviderFetch = await import("./_shared/providerFetch");
const requestedUrls: string[] = [];
let nextAnswer: ProviderFetchResult = { ok: true, status: 200, bodyText: "{}", headers: {} };
mock.module("./_shared/providerFetch", () => ({
  ...realProviderFetch,
  providerFetch: async (requestUrl: string) => {
    requestedUrls.push(requestUrl);
    return nextAnswer;
  },
}));

const { blueskyBehavior } = await import("./bluesky");

function refreshWith(input: { refreshToken: string | null; service: string | null }) {
  const refresh = blueskyBehavior.refresh;
  if (!refresh) throw new Error("Bluesky declares no refresh");
  return refresh({
    accessToken: "expired-access-jwt",
    refreshToken: input.refreshToken,
    config: input.service ? { service: input.service, did: "did:plc:abc" } : {},
  });
}

describe("Bluesky refresh", () => {
  test("a self-hosted account refreshes against its own PDS and keeps the rotated token", async () => {
    requestedUrls.length = 0;
    nextAnswer = {
      ok: true,
      status: 200,
      bodyText: JSON.stringify({ accessJwt: "new-access", refreshJwt: "new-refresh" }),
      headers: {},
    };
    const refreshed = await refreshWith({
      refreshToken: "old-refresh",
      service: "https://pds.example.org/",
    });
    expect(requestedUrls).toEqual([
      "https://pds.example.org/xrpc/com.atproto.server.refreshSession",
    ]);
    expect(refreshed).toEqual({
      ok: true,
      accessToken: "new-access",
      rotatedRefreshToken: "new-refresh",
      expiresIn: 3600,
    });
  });

  test("an account without a stored service refreshes against bsky.social", async () => {
    requestedUrls.length = 0;
    await refreshWith({ refreshToken: "old-refresh", service: null });
    expect(requestedUrls).toEqual([
      "https://bsky.social/xrpc/com.atproto.server.refreshSession",
    ]);
  });

  test("a refused refresh token asks for a reconnect, a 5xx is retryable", async () => {
    nextAnswer = { ok: true, status: 400, bodyText: '{"error":"ExpiredToken"}', headers: {} };
    const refused = await refreshWith({ refreshToken: "old-refresh", service: null });
    expect(refused.ok ? null : refused.reason).toBe("auth_expired");

    nextAnswer = { ok: true, status: 502, bodyText: "", headers: {} };
    const unavailable = await refreshWith({ refreshToken: "old-refresh", service: null });
    expect(unavailable.ok ? null : unavailable.reason).toBe("transient");
  });

  test("no stored refresh token means a reconnect, without a request", async () => {
    requestedUrls.length = 0;
    const refreshed = await refreshWith({ refreshToken: null, service: null });
    expect(refreshed.ok ? null : refreshed.reason).toBe("auth_expired");
    expect(requestedUrls).toEqual([]);
  });
});
