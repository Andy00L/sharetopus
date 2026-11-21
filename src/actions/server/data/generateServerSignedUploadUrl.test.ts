import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@/actions/api/adminSupabase", () => ({ adminSupabase: {} }));
mock.module("@/lib/mcp/_shared/enforceStorageQuota", () => ({
  enforceStorageQuota: async () => ({ success: true }),
}));

const { checkUploadRequest } = await import("./generateServerSignedUploadUrl");

const ONE_KILOBYTE = 1024;

describe("checkUploadRequest content types", () => {
  test("accepts the registered type browsers report for .mov files", () => {
    expect(
      checkUploadRequest({ contentType: "video/quicktime", fileSize: ONE_KILOBYTE, tier: null }),
    ).toEqual({ ok: true });
    expect(
      checkUploadRequest({ contentType: "video/mp4", fileSize: ONE_KILOBYTE, tier: null }),
    ).toEqual({ ok: true });
  });

  test("accepts video/mov, which API clients were told to send, as video/quicktime", () => {
    expect(
      checkUploadRequest({ contentType: "video/mov", fileSize: ONE_KILOBYTE, tier: null }),
    ).toEqual({ ok: true });
  });

  test("refuses an unlisted type and names the accepted types", () => {
    const refusal = checkUploadRequest({ contentType: "video/x-msvideo", fileSize: ONE_KILOBYTE, tier: null });
    expect(refusal.ok).toBe(false);
    if (refusal.ok) return;
    expect(refusal.reason).toBe("content_type_not_allowed");
    expect(refusal.message).toContain("video/quicktime");
  });
});
