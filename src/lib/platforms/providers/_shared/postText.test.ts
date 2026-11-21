import { describe, expect, test } from "bun:test";

import { joinTitleAndBody } from "./postText";

describe("joinTitleAndBody", () => {
  test("a title becomes the trimmed first paragraph", () => {
    expect(joinTitleAndBody({ title: "  Launch ", body: " We shipped. \n" })).toBe(
      "Launch\n\nWe shipped.",
    );
  });

  test("an empty part leaves no separator and no formatted title", () => {
    const boldTitle = { formatTitle: (title: string) => `*${title}*` };
    expect(joinTitleAndBody({ title: " ", body: "Only body" }, boldTitle)).toBe("Only body");
    expect(joinTitleAndBody({ title: "Only title", body: "" }, boldTitle)).toBe("*Only title*");
  });

  test("chat formats join title and body on one line", () => {
    expect(joinTitleAndBody({ title: "Live", body: "now" }, { separator: " " })).toBe("Live now");
  });
});
