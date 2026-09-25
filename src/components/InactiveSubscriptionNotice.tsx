import type { InactiveSubscriptionStatus } from "@/actions/checkActiveSubscription";
import { LoadFailedNotice } from "@/components/LoadFailedNotice";
import { SubscriptionPrompt } from "@/components/SubscriptionPrompt";

/**
 * What a gated page renders when the subscription check grants no access.
 * "none" gets the subscribe prompt. "unavailable" means the check failed on
 * our side, so a paying user gets a retry instead of an offer to buy the
 * plan they already have.
 */
export function InactiveSubscriptionNotice({
  status,
}: {
  readonly status: InactiveSubscriptionStatus;
}) {
  if (status === "none") return <SubscriptionPrompt />;

  return (
    <LoadFailedNotice
      title="We couldn't check your plan"
      description="Something failed on our side, not with your subscription. Try again in a moment."
    />
  );
}
