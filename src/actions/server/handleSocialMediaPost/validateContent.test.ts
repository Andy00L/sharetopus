import { describe, expect, test } from "bun:test";

import type { ClientSocialAccount } from "@/lib/types/dbTypes";

import { validateAccountContent } from "./validateContent";

const INSTAGRAM_ACCOUNT: ClientSocialAccount = {
  id: "account-ig",
  platform: "instagram",
  username: "studio",
  display_name: "Studio",
  avatar_url: null,
  account_identifier: "ig-1",
  is_verified: null,
};

const CONTENT = [
  { accountId: INSTAGRAM_ACCOUNT.id, title: "", description: "hello", link: "", isCustomized: false },
];

describe("validateAccountContent", () => {
  test("an account whose platform cannot take the post type is reported, not skipped", () => {
    expect(validateAccountContent([INSTAGRAM_ACCOUNT], CONTENT, "instagram", undefined, "text")).toEqual([
      {
        accountId: INSTAGRAM_ACCOUNT.id,
        platform: "instagram",
        displayName: "Studio",
        error: "Instagram does not support text posts",
      },
    ]);
  });

  test("a supported post type with content passes", () => {
    expect(validateAccountContent([INSTAGRAM_ACCOUNT], CONTENT, "instagram", undefined, "image")).toEqual([]);
  });
});
