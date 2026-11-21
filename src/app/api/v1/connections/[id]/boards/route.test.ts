import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { NextRequest } from "next/server";

import type { ensureValidToken } from "@/lib/api/ensureValidToken";
import type { RestApiKeyContext } from "@/lib/api/rest/auth/types";
import type { WithRestEndpointConfig } from "@/lib/api/rest/middleware/withRestEndpoint";

mock.module("server-only", () => ({}));

const CONNECTION_ID = "0b6f3a52-6a0e-4d55-9a53-0c1b2f7d8e91";

const REST_CONTEXT: RestApiKeyContext = {
  principal: {
    kind: "rest",
    principalId: "principal-1",
    apiKeyId: "key-1",
    scopes: ["api:full"],
    plan: "creator",
    priceId: null,
  },
  requestId: "request-1",
  ipHash: null,
  userAgent: null,
  endpoint: `/api/v1/connections/${CONNECTION_ID}/boards`,
  httpMethod: "GET",
  startedAt: 0,
};

let tokenResult: Awaited<ReturnType<typeof ensureValidToken>>;
let boardFetchCount = 0;

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async () => ({ data: [{ id: CONNECTION_ID, platform: "pinterest" }], error: null }),
}));

mock.module("@/lib/api/ensureValidToken", () => ({
  ensureValidToken: async () => tokenResult,
}));

mock.module("@/lib/api/pinterest/data/getPinterestBoards", () => ({
  getPinterestBoards: async () => {
    boardFetchCount += 1;
    return { success: true, boards: [], bookmark: null };
  },
}));

mock.module("@/lib/api/rest/middleware/withRestEndpoint", () => ({
  withRestEndpoint: (config: WithRestEndpointConfig) => async (request: NextRequest) => {
    const handled = await config.handler(REST_CONTEXT, request);
    return "auditSummary" in handled ? handled.response : handled;
  },
}));

const { GET } = await import("./route");

async function requestBoards(): Promise<{ status: number; body: unknown }> {
  const response = await GET(
    new NextRequest(`https://sharetopus.com/api/v1/connections/${CONNECTION_ID}/boards`),
  );
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  boardFetchCount = 0;
});

describe("GET /api/v1/connections/{id}/boards when the token cannot be used", () => {
  test("a refresh that failed for now answers 503 with retry advice, not a reconnect", async () => {
    tokenResult = {
      success: false,
      error: "We could not refresh your pinterest connection just now. Please try again in a few minutes.",
      failureReason: "transient",
    };

    const { status, body } = await requestBoards();

    expect(status).toBe(503);
    expect(body).toMatchObject({
      error: { code: "service_unavailable", details: { retry_after_seconds: 30 } },
    });
    expect(JSON.stringify(body)).not.toContain("reauth_url");
    expect(boardFetchCount).toBe(0);
  });

  test("a refused refresh answers 401 with the reauth URL", async () => {
    tokenResult = {
      success: false,
      error: "Your pinterest account needs to be reconnected.",
      failureReason: "auth_expired",
    };

    const { status, body } = await requestBoards();

    expect(status).toBe(401);
    expect(body).toMatchObject({
      error: {
        code: "unauthorized",
        details: { reauth_url: expect.stringContaining(`/api/v1/connections/${CONNECTION_ID}/reauth`) },
      },
    });
    expect(boardFetchCount).toBe(0);
  });
});
