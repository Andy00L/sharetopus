import { describe, expect, test } from "bun:test";

import { classifyTikTokFailReason } from "./tikTokFailReason";

describe("classifyTikTokFailReason", () => {
  test("a media check failure is invalid input", () => {
    expect(classifyTikTokFailReason("file_format_check_failed")).toBe("invalid_input");
    expect(classifyTikTokFailReason("picture_size_check_failed")).toBe("invalid_input");
  });

  test("a download failure or TikTok outage is transient", () => {
    expect(classifyTikTokFailReason("video_pull_failed")).toBe("transient");
    expect(classifyTikTokFailReason("internal")).toBe("transient");
  });

  test("revoked access is auth_expired", () => {
    expect(classifyTikTokFailReason("auth_removed")).toBe("auth_expired");
  });

  test("the daily OpenAPI post cap is rate_limited, every other spam flag is a policy rejection", () => {
    expect(classifyTikTokFailReason("spam_risk_too_many_posts")).toBe("rate_limited");
    expect(classifyTikTokFailReason("spam_risk_text")).toBe("policy_rejected");
    expect(classifyTikTokFailReason("spam_risk_user_banned_from_posting")).toBe("policy_rejected");
  });

  test("a missing, status-only or unlisted reason is unknown", () => {
    expect(classifyTikTokFailReason(undefined)).toBe("unknown");
    expect(classifyTikTokFailReason("")).toBe("unknown");
    expect(classifyTikTokFailReason("FAILED")).toBe("unknown");
    expect(classifyTikTokFailReason("publish_cancelled")).toBe("unknown");
    expect(classifyTikTokFailReason("constructor")).toBe("unknown");
  });
});
