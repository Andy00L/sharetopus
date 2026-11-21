import { getReferralProgress } from "@/actions/server/referral/getReferralProgress";
import { REFERRALS_PER_FREE_WEEK } from "@/lib/referral/referralRules";
import { Suspense } from "react";
import { NavReferralLink } from "./nav-referral-link";

async function NavReferralWithProgress() {
  const progressResult = await getReferralProgress();
  const badge =
    progressResult.success && !progressResult.capReached
      ? `${progressResult.towardNextWeek}/${REFERRALS_PER_FREE_WEEK}`
      : null;
  return <NavReferralLink badge={badge} />;
}

/**
 * Sidebar entry for the referral program, with a progress badge (e.g.
 * "2/3") toward the next free week. The link streams in without the badge
 * and the badge follows once the progress loads; a failed load leaves it out.
 */
export function NavReferral() {
  return (
    <Suspense fallback={<NavReferralLink badge={null} />}>
      <NavReferralWithProgress />
    </Suspense>
  );
}
