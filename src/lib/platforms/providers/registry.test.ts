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

function requireCredentialsProvider(providerId: string) {
  const provider = requireProvider(providerId);
  if (provider.authKind !== "credentials") throw new Error(`${providerId} uses OAuth`);
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
      idempotencyKey: "post-1",
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

describe("credential values are checked against the catalog before the provider runs", () => {
  const blueskyCredentials = { identifier: "me.bsky.social", appPassword: "abcd-efgh-ijkl-mnop" };

  test("a url field that is not https is refused", async () => {
    const connected = await requireCredentialsProvider("bluesky").connect({
      values: { ...blueskyCredentials, service: "http://pds.example.org" },
    });
    expect(connected).toEqual({
      ok: false,
      message: 'Field "service" must be an https:// URL for Bluesky.',
    });
  });

  test("a missing required field is refused", async () => {
    const connected = await requireCredentialsProvider("bluesky").connect({
      values: { identifier: "me.bsky.social", appPassword: "  " },
    });
    expect(connected).toEqual({
      ok: false,
      message: 'Field "appPassword" is required for Bluesky.',
    });
  });

  test("a blank optional url field reaches the provider", async () => {
    const connected = await requireCredentialsProvider("bluesky").connect({
      values: { ...blueskyCredentials, service: "" },
    });
    expect(connected).toEqual({
      ok: false,
      message: "Bluesky could not be connected because of an unexpected error.",
    });
  });
});
