import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ServerContext } from "@modelcontextprotocol/server";

type LoggedAuditEntry = { toolName: string; resultStatus: string };

const loggedAuditEntries: LoggedAuditEntry[] = [];
const backgroundPromises: Promise<unknown>[] = [];
let isRateLimited = false;

mock.module("server-only", () => ({}));
mock.module("@vercel/functions", () => ({
  waitUntil: (pendingPromise: Promise<unknown>) => {
    backgroundPromises.push(pendingPromise);
  },
}));
mock.module("@/actions/server/rateLimit/checkRateLimit", () => ({
  checkRateLimit: async () =>
    isRateLimited
      ? { success: false, reason: "limited", message: "Rate limit exceeded.", resetIn: 12 }
      : { success: true },
}));
mock.module("@/lib/api/context", () => ({
  extractIpHash: async () => null,
  extractUserAgent: async () => null,
}));
mock.module("./entitlement", () => ({ entitlementFor: async () => ({ mode: "allow" }) }));
mock.module("./audit", () => ({
  logToolCall: (entry: LoggedAuditEntry) => {
    loggedAuditEntries.push({ toolName: entry.toolName, resultStatus: entry.resultStatus });
    return new Promise<void>(() => {});
  },
}));

const { jsonResult, withMcpTool } = await import("./withMcpTool");

const SERVER_CONTEXT: Pick<ServerContext, "http"> = {
  http: {
    authInfo: {
      token: "stp_mcp_test",
      clientId: "key-1",
      scopes: [],
      extra: {
        principal: { kind: "apikey", principalId: "user-1", apiKeyId: "key-1", scopes: [], plan: "creator", priceId: null },
        requestId: "request-1",
      },
    },
  },
};

beforeEach(() => {
  loggedAuditEntries.length = 0;
  backgroundPromises.length = 0;
  isRateLimited = false;
});

describe("withMcpTool", () => {
  test("answers before the audit insert finishes and hands it to waitUntil", async () => {
    const listTool = withMcpTool("list_posts", async () => jsonResult({ posts: [] }));

    const toolResult = await listTool({}, SERVER_CONTEXT);

    expect(toolResult.isError).toBeUndefined();
    expect(toolResult.structuredContent).toEqual({ posts: [] });
    expect(loggedAuditEntries).toEqual([{ toolName: "list_posts", resultStatus: "ok" }]);
    expect(backgroundPromises).toHaveLength(1);
  });

  test("a rate-limited call is refused and audited as rate_limited", async () => {
    isRateLimited = true;
    const listTool = withMcpTool("list_posts", async () => jsonResult({ posts: [] }));

    const toolResult = await listTool({}, SERVER_CONTEXT);

    expect(toolResult.isError).toBe(true);
    expect(loggedAuditEntries).toEqual([{ toolName: "list_posts", resultStatus: "rate_limited" }]);
    expect(backgroundPromises).toHaveLength(1);
  });
});
