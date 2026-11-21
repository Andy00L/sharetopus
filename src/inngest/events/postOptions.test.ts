import { describe, expect, test } from "bun:test";

import type { PlatformOptions } from "@/lib/types/dbTypes";

import {
  buildDefaultPlatformOptions,
  decodeStoredPostOptions,
  encodeFormPostOptions,
  PLATFORM_OPTION_DEFAULTS,
  PlatformOptionsSchema,
} from "./postOptions";

const FORM_OPTIONS: PlatformOptions = {
  tiktok: {
    privacyLevel: "SELF_ONLY",
    disableComment: true,
    disableDuet: true,
    disableStitch: false,
    brandContentToggle: true,
    yourBrand: true,
    brandedContent: false,
    isAigc: true,
  },
  pinterest: { privacyLevel: "PROTECTED", board: "", link: "" },
  linkedin: { visibility: "CONNECTIONS" },
  youtube: { privacyStatus: "unlisted" },
};

function storeAndDecode(platform: Parameters<typeof encodeFormPostOptions>[0]["platform"]) {
  const stored = encodeFormPostOptions({
    platform,
    link: "https://example.com/article",
    platformOptions: FORM_OPTIONS,
    pinterestBoard: { boardId: "board-7", boardName: "Recipes" },
  });
  const decoded = decodeStoredPostOptions(JSON.parse(JSON.stringify(stored)));
  if (!decoded.ok) throw new Error(`decode failed: ${decoded.invalidKeys.join(", ")}`);
  return decoded.decoded;
}

describe("post options codec", () => {
  test("a scheduled Pinterest post reads back the board, link and privacy the form chose", () => {
    const decoded = storeAndDecode("pinterest");
    expect(decoded.pinterestBoard).toEqual({ boardId: "board-7", boardName: "Recipes" });
    expect(decoded.link).toBe("https://example.com/article");
    expect(decoded.platformOptions.pinterest?.privacyLevel).toBe("PROTECTED");
  });

  test("a scheduled LinkedIn post reads back the visibility and link the form chose", () => {
    const decoded = storeAndDecode("linkedin");
    expect(decoded.platformOptions.linkedin).toEqual({ visibility: "CONNECTIONS" });
    expect(decoded.link).toBe("https://example.com/article");
  });

  test("a scheduled TikTok post reads back every option the form chose", () => {
    expect(storeAndDecode("tiktok").platformOptions.tiktok).toEqual(FORM_OPTIONS.tiktok);
  });

  test("a scheduled YouTube post reads back the privacy the form chose", () => {
    expect(storeAndDecode("youtube").platformOptions.youtube).toEqual({ privacyStatus: "unlisted" });
  });

  test("options the form left out decode to the one default set", () => {
    const decoded = decodeStoredPostOptions({});
    if (!decoded.ok) throw new Error("decode failed");
    expect(decoded.decoded.platformOptions.pinterest?.privacyLevel).toBe(
      PLATFORM_OPTION_DEFAULTS.pinterestPrivacyLevel,
    );
    expect(decoded.decoded.platformOptions.linkedin?.visibility).toBe(
      PLATFORM_OPTION_DEFAULTS.linkedinVisibility,
    );
    expect(decoded.decoded.platformOptions.youtube?.privacyStatus).toBe(
      PLATFORM_OPTION_DEFAULTS.youtubePrivacyStatus,
    );
    expect(decoded.decoded.platformOptions.tiktok?.disableComment).toBe(
      PLATFORM_OPTION_DEFAULTS.tiktokInteractionDisabled,
    );
  });

  test("a post-now caller without options gets what a scheduled post with the same board and link decodes to", () => {
    const decoded = decodeStoredPostOptions({ board: "board-7", link: "https://example.com" });
    if (!decoded.ok) throw new Error("decode failed");
    expect(
      buildDefaultPlatformOptions({ pinterestBoardId: "board-7", link: "https://example.com" }),
    ).toEqual(decoded.decoded.platformOptions);
  });

  test("a stored privacy level reaches only the platform that defines it", () => {
    const tikTokRow = decodeStoredPostOptions({ privacyLevel: "SELF_ONLY" });
    const pinterestRow = decodeStoredPostOptions({ privacyLevel: "PROTECTED" });
    if (!tikTokRow.ok || !pinterestRow.ok) throw new Error("decode failed");
    expect(tikTokRow.decoded.platformOptions.tiktok?.privacyLevel).toBe("SELF_ONLY");
    expect(tikTokRow.decoded.platformOptions.pinterest?.privacyLevel).toBe(
      PLATFORM_OPTION_DEFAULTS.pinterestPrivacyLevel,
    );
    expect(pinterestRow.decoded.platformOptions.pinterest?.privacyLevel).toBe("PROTECTED");
    expect(pinterestRow.decoded.platformOptions.tiktok?.privacyLevel).toBeUndefined();
  });

  test("decoded options satisfy the post.now event schema", () => {
    expect(PlatformOptionsSchema.safeParse(storeAndDecode("tiktok").platformOptions).success).toBe(
      true,
    );
  });

  test("malformed stored options name the bad keys", () => {
    expect(decodeStoredPostOptions({ privacyStatus: "loud", disableDuet: "yes" })).toEqual({
      ok: false,
      invalidKeys: ["disableDuet", "privacyStatus"],
    });
  });
});
