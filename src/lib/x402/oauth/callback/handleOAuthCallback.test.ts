import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

mock.module("server-only", () => ({}));

type SqlProducer = { toSQL: () => { sql: string } };

const CONNECTION_ID = "6f1f6a43-2b3c-4d5e-8f90-0a1b2c3d4e5f";
const HOUR_MS = 60 * 60 * 1000;

let connectionExpiresAt = "";
let failingUpdateCount = 0;
let updateStatementCount = 0;

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: SqlProducer) => {
    const statement = query.toSQL().sql;
    if (statement.startsWith("update")) {
      updateStatementCount += 1;
      if (failingUpdateCount > 0) {
        failingUpdateCount -= 1;
        return { data: null, error: { message: "connection reset", code: "08006" } };
      }
      return { data: [], error: null };
    }
    return {
      data: [
        {
          id: CONNECTION_ID,
          principal_id: "principal-1",
          platform: "linkedin",
          status: "pending",
          expires_at: connectionExpiresAt,
          share_link_id: null,
          initiated_via: "x402",
          oauth_code_verifier: null,
          redirect_uri: "https://sharetopus.com/api/oauth/callback/linkedin",
        },
      ],
      error: null,
    };
  },
}));

mock.module("next/server", () => ({ after: () => {} }));
mock.module("@/actions/server/share-link/checkShareLinkOwnerCapacity", () => ({
  checkShareLinkOwnerCapacity: async () => ({ ok: true }),
}));
mock.module("@/actions/server/share-link/validateShareToken", () => ({
  validateShareLinkById: async () => ({ success: true }),
}));
mock.module("@/lib/x402/audit/logX402Call", () => ({ logX402Call: async () => {} }));
mock.module("@/lib/api/oauth/connectPlatformAccounts", () => ({
  buildSocialAccountValues: () => ({}),
  connectPlatformAccounts: async () => ({ success: false, message: "unused" }),
}));
mock.module("@/lib/api/rest/webhooks/dispatch", () => ({ dispatchWebhook: () => {} }));

const { handleOAuthCallback } = await import("./handleOAuthCallback");

function runCallback(errorCode: string | null) {
  return handleOAuthCallback({
    platform: "linkedin",
    code: "code-1",
    state: "state-1",
    errorCode,
    errorDescription: null,
  });
}

beforeEach(() => {
  connectionExpiresAt = new Date(Date.now() + HOUR_MS).toISOString();
  failingUpdateCount = 0;
  updateStatementCount = 0;
});

describe("handleOAuthCallback moving a pending connection to a final status", () => {
  test("a transition write that fails once is retried", async () => {
    failingUpdateCount = 1;

    const callbackResult = await runCallback("access_denied");

    expect(callbackResult).toEqual({
      ok: false,
      error: { kind: "provider_error", code: "access_denied", message: "OAuth provider returned an error." },
    });
    expect(updateStatementCount).toBe(2);
  });

  test("a transition write that fails twice still answers with the original failure", async () => {
    connectionExpiresAt = new Date(Date.now() - HOUR_MS).toISOString();
    failingUpdateCount = 2;

    const callbackResult = await runCallback(null);

    expect(callbackResult).toEqual({
      ok: false,
      error: { kind: "state_expired", message: "OAuth connection has expired." },
    });
    expect(updateStatementCount).toBe(2);
  });

  test("a transition write that succeeds is not repeated", async () => {
    await runCallback("access_denied");

    expect(updateStatementCount).toBe(1);
  });
});
