import { eventType } from "inngest";
import { z } from "zod";

import { REFERRAL_CODE_PATTERN } from "@/lib/referral/referralRules";

export const referralSignupEvent = eventType("referral.signup", {
  schema: z.object({
    new_user_id: z.string().min(1),
    referral_code: z.string().regex(REFERRAL_CODE_PATTERN),
  }),
});
