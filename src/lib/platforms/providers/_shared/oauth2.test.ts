import { describe, expect, mock, test } from "bun:test";

import type { ProviderFetchResult } from "./providerFetch";

mock.module("server-only", () => ({}));

let tokenAnswer: ProviderFetchResult = { ok: true, status: 200, bodyText: "{}", headers: {} };
const realProviderFetch = await import("./providerFetch");
mock.module("./providerFetch", () => ({
  ...realProviderFetch,
  providerFetch: async (): Promise<ProviderFetchResult> => tokenAnswer,
}));

const { refreshOAuth2Credential } = await import("./oauth2");

const TEST_OAUTH = {
  authorizeUrl: "https://auth.example.test/authorize",
  tokenUrl: "https://auth.example.test/token",
  clientIdEnv: "TEST_OAUTH_CLIENT_ID",
  clientSecretEnv: "TEST_OAUTH_CLIENT_SECRET",
  scope: "read",
  useBasicAuthForToken: false,
};

process.env.TEST_OAUTH_CLIENT_ID = "client-id";
process.env.TEST_OAUTH_CLIENT_SECRET = "client-secret";

describe("token endpoint errors", () => {
  test("only the RFC 6749 error code and description reach the message", async () => {
    tokenAnswer = {
      ok: true,
      status: 400,
      bodyText: JSON.stringify({
        error: "invalid_grant",
        error_description: "Token has been revoked.",
        refresh_token: "echoed-refresh-token",
      }),
      headers: {},
    };
    const refreshed = await refreshOAuth2Credential(TEST_OAUTH, {
      accessToken: null,
      refreshToken: "stored-refresh-token",
      config: {},
    });
    expect(refreshed).toEqual({
      ok: false,
      message: "Token exchange failed (400): invalid_grant: Token has been revoked.",
      reason: "auth_expired",
    });
  });

  test("a body without RFC 6749 fields is not echoed", async () => {
    tokenAnswer = { ok: true, status: 502, bodyText: "<html>upstream secret</html>", headers: {} };
    const refreshed = await refreshOAuth2Credential(TEST_OAUTH, {
      accessToken: null,
      refreshToken: "stored-refresh-token",
      config: {},
    });
    expect(refreshed).toEqual({
      ok: false,
      message: "Token exchange failed (502).",
      reason: "transient",
    });
  });
});
