import { LoadFailedNotice } from "@/components/LoadFailedNotice";
import RateLimitError from "@/components/RateLimitError";

export function AccountsLoadError({
  rateLimitResetIn,
}: {
  readonly rateLimitResetIn?: number;
}) {
  if (rateLimitResetIn !== undefined) {
    return <RateLimitError resetIn={rateLimitResetIn} />;
  }
  return (
    <LoadFailedNotice
      title="We couldn't load your accounts"
      description="Something failed on our side, not with your accounts. Try again in a moment."
    />
  );
}
