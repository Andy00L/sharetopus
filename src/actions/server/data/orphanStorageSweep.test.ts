import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

mock.module("./storageFiles/mediaReferences", () => ({
  findReferencedMediaPaths: async () => ({ success: true, referenced: new Set<string>() }),
}));

mock.module("@/actions/api/adminSupabase", () => ({
  adminSupabase: {
    storage: {
      from: () => ({
        remove: async () => ({
          data: [{ name: "user_a/third.mp4" }],
          error: null,
        }),
      }),
    },
  },
}));

const { batchDeleteStorageFiles } = await import("./orphanStorageSweep");

describe("batchDeleteStorageFiles", () => {
  test("counts the bytes of the files storage removed, not the first ones of the batch", async () => {
    const result = await batchDeleteStorageFiles({
      bucket: "media",
      paths: ["user_a/first.mp4", "user_a/second.mp4", "user_a/third.mp4"],
      pathSizes: { "user_a/first.mp4": 100, "user_a/second.mp4": 200, "user_a/third.mp4": 300 },
    });
    expect(result).toEqual({ success: true, deletedCount: 1, failedCount: 2, bytesFreed: 300 });
  });
});
