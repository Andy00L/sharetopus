import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

mock.module("@/inngest/client", () => ({
  inngest: {
    createFunction: (config: unknown, handler: (input: unknown) => Promise<unknown>) => ({
      config,
      handler,
    }),
  },
}));

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
    data: null,
    error: { message: "canceling statement due to statement timeout", code: "57014" },
  }),
}));

const { cleanupSocialConnectionsCron } = await import("./cleanupSocialConnectionsCron");

function readHandler(candidate: unknown): (input: unknown) => Promise<unknown> {
  if (typeof candidate !== "object" || candidate === null || !("handler" in candidate)) {
    throw new Error("createFunction mock not applied");
  }
  const handler: unknown = candidate.handler;
  if (typeof handler !== "function") throw new Error("captured handler is not a function");
  return (input: unknown) => Promise.resolve(handler(input));
}

const step = {
  run: async (_stepId: string, stepBody: () => Promise<unknown>) => stepBody(),
};

describe("cleanupSocialConnectionsCron", () => {
  test("a failed DELETE fails the run instead of returning an error object from a green run", async () => {
    await expect(readHandler(cleanupSocialConnectionsCron)({ step })).rejects.toThrow(
      "Delete failed on iteration 0 after 0 deleted: canceling statement due to statement timeout",
    );
  });
});
