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

mock.module("@/actions/server/data/orphanStorageSweep", () => ({
  listAgedStorageFiles: async () => ({ success: false, message: "list failed: 503" }),
  findReferencedStoragePaths: async () => ({ success: true, referenced: [] }),
  batchDeleteStorageFiles: async () => ({
    success: true,
    deletedCount: 0,
    failedCount: 0,
    bytesFreed: 0,
  }),
}));

const { sweepOrphanStorageFiles } = await import("./sweepOrphanStorageFiles");

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

describe("sweepOrphanStorageFiles", () => {
  test("a failed listing fails the run instead of returning ok: false from a green run", async () => {
    await expect(readHandler(sweepOrphanStorageFiles)({ step })).rejects.toThrow(
      "[sweepOrphanStorageFiles] Sweep failed: list failed: 503",
    );
  });
});
