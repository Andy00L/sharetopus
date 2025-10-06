import { PlatformCounts } from "./handleSocialMediaPost";

/**
 * Generate a user-friendly success message based on the results
 */
export function generateSuccessMessage(
  counts: PlatformCounts,
  isScheduled: boolean,
  errorCount: number
): string {
  if (counts.total === 0) {
    return "No posts were processed successfully. Please check your account selections and try again.";
  }

  const action = isScheduled ? "scheduled" : "published";
  const platforms: string[] = [];

  if (counts.pinterest > 0) {
    platforms.push(`${counts.pinterest} on Pinterest`);
  }
  if (counts.linkedin > 0) {
    platforms.push(`${counts.linkedin} on LinkedIn`);
  }
  if (counts.tiktok > 0) {
    platforms.push(`${counts.tiktok} on TikTok`);
  }
  if (counts.instagram > 0) {
    platforms.push(`${counts.instagram} on Instagram`);
  }
  // Format message based on how many platforms were used
  let message = "";
  if (platforms.length === 1) {
    message = `${counts.total} post${counts.total > 1 ? "s" : ""} ${
      platforms[0]
    }`;
  } else if (platforms.length === 2) {
    message = `${counts.total} posts (${platforms.join(" and ")})`;
  } else if (platforms.length === 3) {
    message = `${counts.total} posts (${platforms[0]}, ${platforms[1]}, and ${platforms[2]})`;
  }

  // Add information about failures if any
  if (errorCount > 0) {
    message += ` with ${errorCount} failed account${errorCount > 1 ? "s" : ""}`;
  }

  return `Successfully ${action} ${message}`;
}
