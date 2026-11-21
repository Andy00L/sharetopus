import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const realProviderFetch = await import("./_shared/providerFetch");
mock.module("./_shared/providerFetch", () => ({
  ...realProviderFetch,
  providerFetch: async () => {
    throw new Error("socket exploded");
  },
}));

const { getProvider } = await import("./registry");

function requireProvider(providerId: string) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`${providerId} is not registered`);
  return provider;
}

describe("provider behaviors never throw past the registry", () => {
  test("a publish that throws is a failure that may have published", async () => {
    const published = await requireProvider("discord").publish({
      accessToken: "https://discord.com/api/webhooks/1/secret",
      config: {},
      accountIdentifier: "1",
      title: "",
      body: "hello",
      postType: "text",
      mediaUrl: null,
      fileName: "",
      mediaMimeType: "",
      options: {},
      idempotencyKey: null,
    });
    expect(published).toEqual({
      ok: false,
      message: "Discord publish failed unexpectedly: socket exploded",
      failure: { reason: "unknown", mayHavePublished: true },
    });
  });

  test("a tool that throws is a failure value", async () => {
    const runTool = requireProvider("telegram").runTool;
    if (!runTool) throw new Error("telegram declares no tool");
    const toolResult = await runTool({
      methodName: "getChatInfo",
      accessToken: "bot-token",
      config: {},
      parameters: { chatId: "@channel" },
    });
    expect(toolResult).toEqual({ ok: false, message: "The provider tool failed unexpectedly." });
  });

  test("a refresh that throws is a retryable failure", async () => {
    const refresh = requireProvider("bluesky").refresh;
    if (!refresh) throw new Error("bluesky declares no refresh");
    const refreshed = await refresh({ accessToken: null, refreshToken: "refresh", config: {} });
    expect(refreshed.ok ? null : refreshed.reason).toBe("transient");
  });
});
