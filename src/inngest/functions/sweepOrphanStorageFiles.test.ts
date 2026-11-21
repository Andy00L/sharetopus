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

type ListResult =
  | {
      success: true;
      paths: string[];
      pathSizes: Record<string, number>;
      folderCount: number;
      failedFolderCount: number;
      truncated: boolean;
    }
  | { success: false; message: string };

let nextListResult: ListResult = { success: false, message: "list failed: 503" };
let deletedPaths: string[] = [];

mock.module("@/actions/server/data/orphanStorageSweep", () => ({
  listAgedStorageFiles: async () => nextListResult,
  findReferencedStoragePaths: async () => ({ success: true, referenced: [] }),
  batchDeleteStorageFiles: async (input: { paths: string[] }) => {
    deletedPaths = input.paths;
    return { success: true, deletedCount: input.paths.length, failedCount: 0, bytesFreed: 0 };
  },
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
    nextListResult = { success: false, message: "list failed: 503" };
    await expect(readHandler(sweepOrphanStorageFiles)({ step })).rejects.toThrow(
      "[sweepOrphanStorageFiles] Sweep failed: list failed: 503",
    );
  });

  test("a failed folder listing still sweeps the other folders, then fails the run", async () => {
    nextListResult = {
      success: true,
      paths: ["user_a/orphan.mp4"],
      pathSizes: { "user_a/orphan.mp4": 10 },
      folderCount: 2,
      failedFolderCount: 1,
      truncated: false,
    };
    await expect(readHandler(sweepOrphanStorageFiles)({ step })).rejects.toThrow(
      "1 folder listing(s) failed",
    );
    expect(deletedPaths).toEqual(["user_a/orphan.mp4"]);
  });
});
