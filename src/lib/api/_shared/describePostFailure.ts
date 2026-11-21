import type { Platform } from "@/db/schema";

export function describePostFailure(
  postResult: { error?: string; message?: string },
  platform: Platform,
): string {
  const failureParts = [postResult.error, postResult.message].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  const distinctParts = [...new Set(failureParts)];
  return distinctParts.length > 0
    ? distinctParts.join(": ")
    : `Failed to post to ${platform}`;
}
