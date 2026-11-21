import type { PlatformFailureReason } from "@/lib/api/_shared/platformFailure";

export type PublishFailure = {
  ok: false;
  reason: PlatformFailureReason;
  message: string;
  mayHavePublished: boolean;
};

export type PlatformPostOutcome = { ok: true; contentId: string } | PublishFailure;

export function isSafeToRetryPost(
  failure: Pick<PublishFailure, "reason" | "mayHavePublished">,
): boolean {
  if (failure.mayHavePublished) return false;
  return failure.reason === "rate_limited" || failure.reason === "transient";
}

export function buildInputRefusal(message: string): PublishFailure {
  return { ok: false, reason: "invalid_input", message, mayHavePublished: false };
}

export function buildMissingMediaRefusal(storageMessage: string): PublishFailure {
  return buildInputRefusal(`Media file no longer exists: ${storageMessage}`);
}
