import type { PlatformFailureReason } from "@/lib/api/_shared/platformFailure";

// fail_reason values of /v2/post/publish/status/fetch/ and the
// post.publish.failed webhook:
// https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status
const TIKTOK_FAIL_REASON_CLASSES = new Map<string, PlatformFailureReason>([
  ["file_format_check_failed", "invalid_input"],
  ["duration_check_failed", "invalid_input"],
  ["frame_rate_check_failed", "invalid_input"],
  ["picture_size_check_failed", "invalid_input"],
  ["internal", "transient"],
  ["video_pull_failed", "transient"],
  ["photo_pull_failed", "transient"],
  ["auth_removed", "auth_expired"],
  ["spam_risk_too_many_posts", "rate_limited"],
  ["spam_risk_user_banned_from_posting", "policy_rejected"],
  ["spam_risk_text", "policy_rejected"],
  ["spam_risk", "policy_rejected"],
]);

export function classifyTikTokFailReason(
  failReason: string | null | undefined,
): PlatformFailureReason {
  if (!failReason) return "unknown";
  return TIKTOK_FAIL_REASON_CLASSES.get(failReason) ?? "unknown";
}
