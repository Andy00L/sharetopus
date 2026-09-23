/**
 * Referral program rules shared by the attribution cookie (src/proxy.ts),
 * signup attribution (ensureUserExists) and the referral UI.
 *
 * The reward itself is computed by the grant_referral_rewards SQL function
 * in the live Supabase database, which hardcodes the same numbers (3
 * referrals per week, 15 referrals lifetime, 7 days per week). Change both
 * together.
 */

/** First-touch attribution cookie holding a referral code. */
export const REFERRAL_COOKIE_NAME = "stx_ref";

/** Lifetime of the attribution cookie, in seconds (30 days). */
export const REFERRAL_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Verified referrals that earn one free week. sourceRef: grant_referral_rewards (SQL). */
export const REFERRALS_PER_FREE_WEEK = 3;

/** Lifetime cap on free weeks earned from referrals. sourceRef: grant_referral_rewards (SQL). */
export const MAX_REFERRAL_WEEKS = 5;
