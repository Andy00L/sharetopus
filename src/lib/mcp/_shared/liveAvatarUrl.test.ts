import { describe, expect, test } from "bun:test";

import { selectLiveAvatarUrl } from "./liveAvatarUrl";

const NOW_MS = Date.parse("2026-11-19T12:00:00Z");
const PAST_SECONDS = Date.parse("2026-10-02T22:00:00Z") / 1000;
const FUTURE_SECONDS = Date.parse("2026-12-01T00:00:00Z") / 1000;

describe("selectLiveAvatarUrl", () => {
  test("drops a TikTok avatar whose x-expires has passed", () => {
    const expiredUrl = `https://p16-common-sign.tiktokcdn-eu.com/avatar.jpeg?x-expires=${PAST_SECONDS}&x-signature=abc`;
    expect(selectLiveAvatarUrl(expiredUrl, NOW_MS)).toBeNull();
  });

  test("keeps a TikTok avatar that has not expired yet", () => {
    const liveUrl = `https://p16-common-sign.tiktokcdn.com/avatar.jpeg?x-expires=${FUTURE_SECONDS}&x-signature=abc`;
    expect(selectLiveAvatarUrl(liveUrl, NOW_MS)).toBe(liveUrl);
  });

  test("drops a LinkedIn media avatar whose e parameter has passed", () => {
    const expiredUrl = `https://media.licdn.com/dms/image/v2/photo?e=${PAST_SECONDS}&v=beta&t=xyz`;
    expect(selectLiveAvatarUrl(expiredUrl, NOW_MS)).toBeNull();
  });

  test("ignores an e parameter on hosts other than LinkedIn media", () => {
    const pinterestUrl = `https://i.pinimg.com/avatar.jpg?e=${PAST_SECONDS}`;
    expect(selectLiveAvatarUrl(pinterestUrl, NOW_MS)).toBe(pinterestUrl);
  });

  test("keeps unsigned avatars and drops malformed or empty values", () => {
    expect(selectLiveAvatarUrl("https://s.pinimg.com/images/user/default.png", NOW_MS)).toBe(
      "https://s.pinimg.com/images/user/default.png",
    );
    expect(selectLiveAvatarUrl("not a url", NOW_MS)).toBeNull();
    expect(selectLiveAvatarUrl(null, NOW_MS)).toBeNull();
    expect(
      selectLiveAvatarUrl("https://p16-common-sign.tiktokcdn.com/a.jpeg?x-expires=soon", NOW_MS),
    ).toBeNull();
  });
});
