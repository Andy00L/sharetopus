import { describe, expect, test } from "bun:test";

import { buildTikTokRepollEvents } from "./tikTokPublishPoll";

describe("buildTikTokRepollEvents", () => {
  test("one event id per pull and UTC hour, so a second sweep in the same hour sends nothing new", () => {
    const pulls = [
      { publish_id: "v_pub_1", social_account_id: "account-1" },
      { publish_id: "v_pub_2", social_account_id: "account-2" },
    ];
    const firstSweep = buildTikTokRepollEvents({ pulls, now: new Date("2026-11-20T03:40:00Z") });
    const sameHourRetry = buildTikTokRepollEvents({ pulls, now: new Date("2026-11-20T03:59:59Z") });
    const nextHour = buildTikTokRepollEvents({ pulls, now: new Date("2026-11-20T04:40:00Z") });

    expect(firstSweep.map((pollEvent) => pollEvent.id)).toEqual([
      "tiktok-repoll-v_pub_1-2026-11-20T03",
      "tiktok-repoll-v_pub_2-2026-11-20T03",
    ]);
    expect(sameHourRetry.map((pollEvent) => pollEvent.id)).toEqual(firstSweep.map((pollEvent) => pollEvent.id));
    expect(nextHour[0].id).toBe("tiktok-repoll-v_pub_1-2026-11-20T04");
    expect(firstSweep[1]).toMatchObject({
      name: "tiktok.publish.poll",
      data: { publish_id: "v_pub_2", social_account_id: "account-2" },
    });
  });
});
