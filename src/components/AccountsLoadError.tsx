import { LoadFailedNotice } from "@/components/LoadFailedNotice";
import RateLimitError from "@/components/RateLimitError";

/**
 * What a page renders when fetchSocialAccounts fails. fetchSocialAccounts
 * sets resetIn only when the user hit the rate limit, so the countdown
 * screen shows for that case alone; a database error or a limiter outage
 * gets a retry card that does not tell the user they went too fast.
 *
 * Used by: /connections and the /create/{text,image,video} pages
 */
export function AccountsLoadError({
  resetIn,
}: {
  readonly resetIn?: number;
}) {
  if (resetIn !== undefined) {
    return <RateLimitError resetIn={resetIn} />;
  }
  return (
    <LoadFailedNotice
      title="We couldn't load your accounts"
      description="Something failed on our side, not with your accounts. Try again in a moment."
    />
  );
}
