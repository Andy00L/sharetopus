# Referral System Implementation Report

## Files Created / Modified / Deleted

| Action | File |
|--------|------|
| CREATED | `src/actions/server/referral/generateReferralCode.ts` |
| CREATED | `src/actions/server/referral/recordReferralOnSignup.ts` |
| CREATED | `src/actions/server/referral/triggerReferralGrant.ts` |
| CREATED | `src/actions/server/referral/getReferralProgress.ts` |
| CREATED | `src/actions/server/referral/getReferralSummary.ts` |
| CREATED | `src/components/sidebar/nav-referral.tsx` |
| CREATED | `src/app/(protected)/referral/page.tsx` |
| CREATED | `src/app/(protected)/referral/copy-link-button.tsx` |
| MODIFIED | `src/lib/types/database.types.ts` |
| MODIFIED | `src/actions/checkActiveSubscription.ts` |
| MODIFIED | `src/actions/server/ensureUserExists.ts` |
| MODIFIED | `src/proxy.ts` |
| MODIFIED | `src/components/sidebar/app-sidebar.tsx` |
| DELETED | (none) |

## database.types.ts

Hand-edited (NO `supabase gen types` CLI). Added:

- **Tables**: `referral_codes` (Row/Insert/Update/Relationships), `referrals` (Row/Insert/Update/Relationships), `referral_reward_grants` (Row/Insert/Update/Relationships)
- **Column**: `creator_access_until: string | null` on `users` (Row, optional in Insert, optional in Update)
- **RPC**: `grant_referral_rewards: { Args: { p_referrer_id: string }; Returns: number }` in Functions
- **Enum alias**: `ReferralStatus = "pending" | "verified" | "redeemed" | "void"`
- **Row aliases**: `ReferralCode`, `Referral`, `ReferralRewardGrant`

Format matches existing tables exactly. `tsc --noEmit` passes with zero src/ errors.

## Canonical Gate

### Resolved path
`src/actions/checkActiveSubscription.ts:25` -- `checkActiveSubscription(userId: string | null): Promise<ActiveSubscription>`

### Exact diff
After the Stripe query returns no active subscription (`if (!data)`), added a fallback:

```typescript
// Referral-granted Creator access fallback
const { data: userData } = await adminSupabase
  .from("users")
  .select("creator_access_until")
  .eq("id", userId)
  .single();

if (
  userData?.creator_access_until &&
  new Date(userData.creator_access_until) > new Date()
) {
  return {
    isActive: true,
    priceId: null,
    tier: "creator" as PlanTier,
    status: "referral_grant",
    currentPeriodEnd: userData.creator_access_until,
    startDate: null,
  };
}
```

Stripe active subscriptions always take precedence (referral check only runs when Stripe returns no active sub). `ActiveSubscription.status` is typed `string`, so `"referral_grant"` is accepted without a type change.

### Full caller-compatibility table

| # | Caller | File:Line | Fields Consumed | Compatible? |
|---|--------|-----------|-----------------|-------------|
| 1 | `applySubscriptionGate` | `applySubscriptionGate.ts:39` | `.isActive`, `.tier`, `.priceId` | YES |
| 2 | `connections/page.tsx` | `:27` | `.isActive`, `.tier` | YES |
| 3 | `create/text/page.tsx` | `:14,23` | `.isActive`, `.tier` | YES |
| 4 | `create/image/page.tsx` | `:15,23` | `.isActive`, `.tier` | YES |
| 5 | `create/video/page.tsx` | `:17,25` | `.isActive`, `.tier` | YES |
| 6 | `create/page.tsx` | `:1` | unused import | YES |
| 7 | `posted/page.tsx` | `:12` | `.isActive` | YES |
| 8 | `pricing.tsx` | `:66` | `.isActive` | YES |
| 9 | `nav-user.tsx` | `:67` | `.isActive` | YES |
| 10 | `integrations/page.tsx` | `:24` | `.isActive` | YES |
| 11 | `generate-upload-url/route.ts` | `:56` | `.isActive`, `.tier` | YES |
| 12 | `instagram/initiate/route.ts` | `:23` | `.isActive`, `.tier` | YES |
| 13 | `pinterest/initiate/route.ts` | `:23` | `.isActive`, `.tier` | YES |
| 14 | `tiktok/initiate/route.ts` | `:23` | `.isActive`, `.tier` | YES |
| 15 | `linkedin/initiate/route.ts` | `:23` | `.isActive`, `.tier` | YES |
| 16 | `customerPortal.ts` | `:73` | `.isActive` | YES |
| 17 | `createApiKey.ts` | `:47` | `.isActive` | YES |
| 18 | `listBillingSummary.ts` | `:33` | all fields | YES |
| 19 | `usage/route.ts` | `:22` | `.tier`, `.status`, `.currentPeriodEnd` | YES |

No caller breaks. Change is purely additive (extra fallback path, same return shape).

## Cache Invalidation

- **Function reused**: `invalidateCachedSubscription(principalId: string)` from `src/lib/mcp/auth/resolvers/subscriptionCache.ts:83`
- **Same function** the Stripe webhook uses on subscription.created/updated/deleted
- **Where called**: `src/actions/server/referral/triggerReferralGrant.ts:48` -- after `grant_referral_rewards` RPC returns `weeksGranted > 0`
- **Effect**: Referrer's new Creator access is visible on the next web request to the same Vercel instance. Other instances catch up at the 60s TTL.

## Clerk Verification Decision

**Straight to `verified` at creation time.**

Clerk enforces email verification before the `user.created` event fires. The webhook handler at `src/app/api/webhooks/clerk/route.ts:104` does not check `verification.status` -- it trusts Clerk has already verified. Therefore:
- Referral rows are inserted as `status: "verified"` with `verified_at: now()`
- The grant trigger is called immediately after insertion
- No `user.updated` handler needed to flip from `pending` to `verified`

## Middleware Cookie Approach

### Changes to `src/proxy.ts`:
1. Added `import { NextResponse } from "next/server"`
2. Added `/referral(.*)` to `isProtectedRoute` matcher
3. At the top of the `clerkMiddleware` callback, before the public/protected checks:
   - Read `?ref=` query param
   - Validate: present, not a protected route, no existing `stx_ref` cookie, regex `^[A-Z0-9]{1,16}$`
   - If valid: `NextResponse.next()` with `Set-Cookie: stx_ref` (30 days, SameSite=Lax, Secure, Path=/)
   - Return the response (first-touch, never overwritten)
4. Existing Clerk behavior fully preserved: public routes return early, protected routes call `auth.protect()`

### How Clerk behavior is preserved:
- The cookie logic runs BEFORE the public/protected checks
- It only fires for non-protected routes (homepage `/?ref=CODE`)
- For protected routes, `auth.protect()` runs unchanged
- Returning `NextResponse.next()` with a cookie is equivalent to the existing fall-through behavior, plus the Set-Cookie header

## Edge-Case Verification Table

| Edge Case | How Handled | File:Line |
|-----------|------------|-----------|
| Self-referral (same user ID) | `referrerId === newUserId` check | `recordReferralOnSignup.ts:69` |
| Self-referral (same email) | Email comparison (case-insensitive) | `recordReferralOnSignup.ts:79` |
| Duplicate `referred_id` | Unique constraint (`23505`) caught gracefully | `recordReferralOnSignup.ts:97` |
| Cap 15 / 5 weeks | Enforced by `grant_referral_rewards` RPC; app code does NOT re-check | `triggerReferralGrant.ts:32` |
| Attribution failure blocks signup | Never: `ensureReferralCode` and `recordReferralOnSignup` are `.catch()`-wrapped | `ensureUserExists.ts:102-105` |
| Cookie first-touch (not overwritten) | `!req.cookies.has("stx_ref")` guard | `proxy.ts:37` |
| Malformed `?ref=` ignored | Regex `^[A-Z0-9]{1,16}$` rejects bad input | `proxy.ts:39` |
| `creator_access_until` past/null | `new Date(value) > new Date()` check | `checkActiveSubscription.ts:68` |
| Cache invalidated after grant | `invalidateCachedSubscription(referrerId)` called when `weeksGranted > 0` | `triggerReferralGrant.ts:48` |
| Gate return shape compatible | Additive-only change; see compatibility table above | `checkActiveSubscription.ts:60-76` |
| x402/wallet principals excluded | Referral flow only triggers via `ensureUserExists` which requires `currentUser()` (Clerk) | `ensureUserExists.ts:14` |
| Banking-past-subscription | Handled by the RPC (`COALESCE(current_period_end, end_date)`) | RPC (DB-side) |
| Code collision at generation | Retry loop with fresh random code, max 5 attempts | `generateReferralCode.ts:60-90` |
| Unknown referral code at signup | Logged, cookie cleared, signup continues | `recordReferralOnSignup.ts:56` |

## Known Limitation

**MCP/REST per-session plan cache**: MCP and REST resolve the principal's plan at auth time (per session). Referral access granted mid-session reaches MCP only on the next auth. This is acceptable because:
- Referral access targets web social-connect primarily
- MCP sessions are short-lived and re-auth frequently
- The subscription cache (60s TTL) is invalidated immediately for web paths

## Invariant Grep Results

```
grep ": any\b|as unknown as" -- 0 matches in src/ (comment-only false positive excluded)
grep em-dash -- 0 matches in new files
tsc --noEmit -- 0 errors in src/ (4 pre-existing errors in .next/types/validator.ts from stale locale route)
npm run build -- clean, /referral route listed
```

## Manual Steps for Drew

1. **Commit** the changes (no type regen needed; types were hand-edited)
2. **End-to-end preview test**:
   - Fresh browser (or incognito), visit `/?ref=<CODE>` (use a test user's code from `referral_codes` table)
   - Sign up with a new test account
   - Confirm `referrals` row with `status='verified'` pointing to the referrer
   - Repeat 2 more times (3 total referrals for the same referrer)
   - Confirm `referral_reward_grants` row created, `creator_access_until` advanced by 1 week
   - Confirm the referrer's web access unlocks immediately (no page reload needed after cache invalidation)
   - Check `/referral` page shows correct progress and earned weeks
3. **Verify sidebar**: "Refer & Earn" item visible at bottom with badge (e.g., "0/3")
4. **No SQL execution needed** -- the DB schema is already applied
5. **No Supabase CLI needed** -- types were hand-edited
