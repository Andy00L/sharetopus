import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

function buildChainableQuery(): object {
  const chainableQuery: object = new Proxy(() => chainableQuery, {
    get: () => () => chainableQuery,
    apply: () => chainableQuery,
  });
  return chainableQuery;
}

mock.module("@/db/client", () => ({
  db: buildChainableQuery(),
  runQuery: async () => ({
    data: [{ platform: "linkedin", access_token: "token", extra: {} }],
    error: null,
  }),
}));

const { listProviderToolsForAccount, runProviderToolForAccount } = await import(
  "./runProviderTool"
);

const LEGACY_ACCOUNT = { principalId: "principal-1", socialAccountId: "account-1" };

describe("provider tools on a legacy platform account", () => {
  test("discovery lists no tools under the platform's label", async () => {
    expect(await listProviderToolsForAccount(LEGACY_ACCOUNT)).toEqual({
      ok: true,
      providerId: "linkedin",
      providerLabel: "LinkedIn",
      tools: [],
    });
  });

  test("running a tool names the missing tool", async () => {
    const toolResult = await runProviderToolForAccount({
      ...LEGACY_ACCOUNT,
      methodName: "listPages",
      parameters: {},
    });
    expect(toolResult).toEqual({
      ok: false,
      reason: "unknown_tool",
      message: 'LinkedIn has no tool named "listPages".',
    });
  });
});
