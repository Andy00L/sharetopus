import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { generateShareToken, isShareTokenFormat } = await import("./token");

describe("share token format", () => {
  test("every generated token passes the format check", () => {
    const tokens = Array.from({ length: 200 }, () => generateShareToken());
    expect(tokens.every((token) => isShareTokenFormat(token))).toBe(true);
  });

  test("rejects a token one character short or long, and non-base64url characters", () => {
    const token = generateShareToken();
    expect(isShareTokenFormat(token.slice(1))).toBe(false);
    expect(isShareTokenFormat(`${token}A`)).toBe(false);
    expect(isShareTokenFormat(`${token.slice(1)}=`)).toBe(false);
  });
});
