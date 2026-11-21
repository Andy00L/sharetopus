import { describe, expect, test } from "bun:test";

import { splitTextIntoChunks, truncateToGraphemesAndBytes } from "./textLimits";

describe("truncateToGraphemesAndBytes", () => {
  test("counts a family emoji as one grapheme and never cuts it", () => {
    const familyEmoji = "\u{1F468}‍\u{1F469}‍\u{1F467}";
    const truncated = truncateToGraphemesAndBytes(`ab${familyEmoji}cd`, {
      maxGraphemes: 3,
      maxUtf8Bytes: 2048,
    });
    expect(truncated).toBe(`ab${familyEmoji}`);
  });

  test("stops at the byte cap before the grapheme cap", () => {
    const familyEmoji = "\u{1F468}‍\u{1F469}‍\u{1F467}";
    const truncated = truncateToGraphemesAndBytes(familyEmoji.repeat(200), {
      maxGraphemes: 500,
      maxUtf8Bytes: 2048,
    });
    expect(Buffer.byteLength(familyEmoji, "utf8")).toBe(18);
    expect(truncated).toBe(familyEmoji.repeat(113));
  });

  test("keeps short text unchanged", () => {
    expect(truncateToGraphemesAndBytes("hello", { maxGraphemes: 500, maxUtf8Bytes: 2048 })).toBe(
      "hello",
    );
  });
});

describe("splitTextIntoChunks", () => {
  test("every chunk fits and no text is lost except the break characters", () => {
    const paragraph = "word ".repeat(1500).trim();
    const chunks = splitTextIntoChunks(paragraph, 3000);
    expect(chunks.every((chunk) => chunk.length <= 3000)).toBe(true);
    expect(chunks.join(" ")).toBe(paragraph);
  });

  test("never splits a surrogate pair", () => {
    const emojiText = "\u{1F600}".repeat(2000);
    const chunks = splitTextIntoChunks(emojiText, 3001);
    expect(chunks.every((chunk) => chunk.length <= 3001)).toBe(true);
    expect(chunks.join("")).toBe(emojiText);
  });

  test("text within the limit is one chunk, empty text is none", () => {
    expect(splitTextIntoChunks("short", 3000)).toEqual(["short"]);
    expect(splitTextIntoChunks("", 3000)).toEqual([]);
  });
});
