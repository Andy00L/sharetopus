import type { SocialAccountsLoadFailure } from "@/actions/server/data/fetchSocialAccounts";
import { LoadFailedNotice } from "@/components/LoadFailedNotice";
import RateLimitError from "@/components/RateLimitError";

export function AccountsLoadError({
  failure,
}: {
  readonly failure: SocialAccountsLoadFailure;
}) {
  switch (failure.reason) {
    case "rate_limited":
      return <RateLimitError resetIn={failure.resetIn} />;
    case "unavailable":
      return (
        <LoadFailedNotice
          title="We couldn't load your accounts"
          description="Something failed on our side, not with your accounts. Try again in a moment."
        />
      );
    default: {
      const _exhaustive: never = failure;
      return _exhaustive;
    }
  }
}
