import {
  PLATFORM_LABELS,
  POSTING_PLATFORMS,
} from "@/lib/platforms/capabilities";
import { PlatformCounts } from "./handleSocialMediaPost";

/**
 * Generate a user-friendly success message based on the results
 */
export function generateSuccessMessage(
  counts: PlatformCounts,
  isScheduled: boolean,
  errorCount: number,
): string {
  if (counts.total === 0) {
    return "No posts were processed successfully. Please check your account selections and try again.";
  }

  const action = isScheduled ? "scheduled" : "published";

  const platformSummaries = POSTING_PLATFORMS.filter(
    (platform) => counts[platform] > 0,
  ).map((platform) => `${counts[platform]} on ${PLATFORM_LABELS[platform]}`);

  let message = "";
  if (platformSummaries.length === 1) {
    message = `${counts.total} post${counts.total > 1 ? "s" : ""} ${platformSummaries[0]}`;
  } else if (platformSummaries.length === 2) {
    message = `${counts.total} posts (${platformSummaries.join(" and ")})`;
  } else {
    const lastSummary = platformSummaries[platformSummaries.length - 1];
    const leadingSummaries = platformSummaries.slice(0, -1).join(", ");
    message = `${counts.total} posts (${leadingSummaries}, and ${lastSummary})`;
  }

  if (errorCount > 0) {
    message += ` with ${errorCount} failed account${errorCount > 1 ? "s" : ""}`;
  }

  let result = `Successfully ${action} ${message}`;

  // TikTok processing notice (applies regardless of compliance flag)
  if (counts.tiktok > 0) {
    result +=
      ". Your TikTok post may take a few minutes to appear on your profile.";
  }

  return result;
}
