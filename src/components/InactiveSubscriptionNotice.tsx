import type { InactiveSubscriptionStatus } from "@/actions/checkActiveSubscription";
import { RefreshPageButton } from "@/components/RefreshPageButton";
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
    <article
      role="alert"
      className="mx-4 mt-6 max-w-md rounded-xl border border-border bg-card p-6 sm:mx-auto"
    >
      <h2 className="text-lg font-semibold text-foreground">
        We couldn&apos;t check your plan
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Something failed on our side, not with your subscription. Try again in
        a moment.
      </p>
      <div className="mt-5">
        <RefreshPageButton />
      </div>
    </article>
  );
}
