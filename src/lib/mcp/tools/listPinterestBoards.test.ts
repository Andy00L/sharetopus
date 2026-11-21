import { describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

import type { ensureValidToken } from "@/lib/api/ensureValidToken";

mock.module("server-only", () => ({}));

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
type ToolContext = { principal: { principalId: string }; requestId: string | null };
type ToolHandler = (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>;

const PINTEREST_ACCOUNT_ID = "0b6f3a52-6a0e-4d55-9a53-0c1b2f7d8e91";

let capturedHandler: ToolHandler | null = null;
let tokenResult: Awaited<ReturnType<typeof ensureValidToken>>;

mock.module("@/lib/mcp/withMcpTool", () => ({
  withMcpTool: (_toolName: string, handler: ToolHandler) => {
    capturedHandler = handler;
    return handler;
  },
  errorResult: (message: string): ToolResult => ({
    content: [{ type: "text", text: message }],
    isError: true,
  }),
  jsonResult: (value: Record<string, unknown>): ToolResult => ({
    content: [{ type: "text", text: JSON.stringify(value) }],
  }),
}));

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async () => ({ data: [{ id: PINTEREST_ACCOUNT_ID, platform: "pinterest" }], error: null }),
}));

mock.module("@/lib/api/ensureValidToken", () => ({
  ensureValidToken: async () => tokenResult,
}));

mock.module("@/lib/api/pinterest/data/getPinterestBoards", () => ({
  getPinterestBoards: async () => ({ success: true, boards: [], bookmark: null }),
}));

await import("./listPinterestBoards");

async function callListPinterestBoards(): Promise<ToolResult> {
  if (!capturedHandler) throw new Error("list_pinterest_boards registered no handler");
  return capturedHandler(
    { principal: { principalId: "principal-1" }, requestId: "request-1" },
    { social_account_id: PINTEREST_ACCOUNT_ID, page_size: 25 },
  );
}

describe("list_pinterest_boards when the token cannot be used", () => {
  test("a refresh that failed for now asks the agent to retry, not to reconnect", async () => {
    tokenResult = {
      success: false,
      error: "We could not refresh your pinterest connection just now. Please try again in a few minutes.",
      failureReason: "transient",
    };

    const toolResult = await callListPinterestBoards();

    expect(toolResult.isError).toBe(true);
    expect(toolResult.content[0]?.text).toContain("Retry");
    expect(toolResult.content[0]?.text).not.toContain("reconnect");
  });

  test("a refused refresh asks the user to reconnect", async () => {
    tokenResult = {
      success: false,
      error: "Your pinterest account needs to be reconnected.",
      failureReason: "auth_expired",
    };

    const toolResult = await callListPinterestBoards();

    expect(toolResult.isError).toBe(true);
    expect(toolResult.content[0]?.text).toContain("needs to be reconnected");
  });
});
