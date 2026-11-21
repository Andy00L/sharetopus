import type { InactiveSubscriptionStatus } from "@/actions/checkActiveSubscription";
import { LoadFailedNotice } from "@/components/LoadFailedNotice";
import { SubscriptionPrompt } from "@/components/SubscriptionPrompt";

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
