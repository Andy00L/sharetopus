import "server-only";

import { referralSignupEvent } from "@/inngest/events/referralSignup";
import { recordReferralOnSignup } from "@/lib/referral/recordReferralOnSignup";
import { triggerReferralGrant } from "@/lib/referral/triggerReferralGrant";

import { inngest } from "../client";

// Inngest retries a step only when it throws, the documented exception to
// errors-as-values for background jobs:
// https://www.inngest.com/docs/guides/error-handling
export const recordReferralSignup = inngest.createFunction(
  {
    id: "record-referral-signup",
    name: "Record a referred signup and grant the referrer's reward",
    retries: 3,
    triggers: [referralSignupEvent],
  },
  async ({ event, step }) => {
    const attribution = await step.run("record-referral", async () => {
      const outcome = await recordReferralOnSignup({
        newUserId: event.data.new_user_id,
        referralCode: event.data.referral_code,
      });
      if (outcome.kind === "failed") {
        throw new Error(`[recordReferralSignup] ${outcome.message}`);
      }
      return outcome;
    });
    if (attribution.kind !== "recorded") return attribution;

    const weeksGranted = await step.run("grant-referral-rewards", async () => {
      const grant = await triggerReferralGrant(attribution.referrerId);
      if (!grant.success) {
        throw new Error(
          `[recordReferralSignup] Reward grant failed for referrer ${attribution.referrerId}: ${grant.message}`,
        );
      }
      return grant.weeksGranted;
    });
    return { ...attribution, weeksGranted };
  },
);
