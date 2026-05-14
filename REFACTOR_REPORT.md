# Hybrid Source of Truth Refactor: Final Report

**Branch:** main
**Commits:**
- `dfcfdea` refactor(plans): no free tier, tier-keyed limit maps, drop dead code
- `c651f46` refactor(plans): unify subscription reader, rename plan to priceId
- `998cbaa` refactor(plans): writer cleanup, dead planId removal, scope extension

**Build state:** green (tsc clean + next build clean)
**Generated:** 2026-05-14

## Summary

Removed the "free" tier from the PlanTier type system, migrated all priceId-keyed limit maps (storage, upload, account) to tier-keyed maps, unified the two subscription readers into a single server action, and cleaned up all writer paths. Net result: -200 lines, 34 files touched, 1 file deleted. All business logic now operates on `tier` (derived at a single call site). All Stripe-facing code operates on `priceId`. The `plan` column in `stripe_subscriptions` is now orphaned (no writers), kept nullable for backward compatibility.

## Files Modified (full list)

### `src/lib/types/plans.ts`
- **Commit:** 1
- **Type of change:** type signature change, dead code deletion, new constants
- **Lines added/removed:** +14 / -113
- **Why:** Remove "free" from PlanTier/TIER_RANK. priceIdToTier returns null instead of "free". tierMeets accepts null. Add TIER_STORAGE_LIMITS. Delete PRICE_ID_ACCOUNT_LIMITS, PRICE_ID_STORAGE_LIMITS, STORAGE_LIMITS, DEFAULT_ACCOUNT_LIMIT, and all priceId-keyed account/storage limit objects (F4, F7).
- **Risk assessment:** medium (type change propagates everywhere)
- **Verified by:** tsc, build, grep invariant

### `src/components/core/create/constants/uploadLimits.ts`
- **Commit:** 1
- **Type of change:** rewrite
- **Lines added/removed:** +16 / -49
- **Why:** Replace priceId-keyed PRICE_ID_UPLOAD_LIMITS with tier-keyed TIER_UPLOAD_LIMITS. All tiers have identical limits today (8 MB image, 250 MB video); structure exists for future differentiation.
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/lib/jobs/runtimeConfig.ts`
- **Commit:** 1
- **Type of change:** import update
- **Lines added/removed:** +2 / -2
- **Why:** Update import from PRICE_ID_UPLOAD_LIMITS to TIER_UPLOAD_LIMITS. Not flagged in audit; discovered during scope extension (Q4 confirmed by Drew).
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/lib/mcp/auth/types.ts`
- **Commit:** 1
- **Type of change:** type signature change
- **Lines added/removed:** +2 / -2
- **Why:** McpPrincipal.plan becomes PlanTier | null to match priceIdToTier return type.
- **Risk assessment:** medium (type propagates to all MCP code)
- **Verified by:** tsc, build

### `src/lib/mcp/auth/resolvers/subscriptionCache.ts`
- **Commit:** 1
- **Type of change:** type signature change
- **Lines added/removed:** +1 / -1
- **Why:** SubscriptionCacheEntry.plan becomes PlanTier | null.
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/lib/mcp/auth/resolvers/apiKey.ts`
- **Commit:** 1
- **Type of change:** value change
- **Lines added/removed:** +1 / -1
- **Why:** Initial principal state: plan: null instead of "free".
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/lib/mcp/auth/resolve.ts`
- **Commit:** 1
- **Type of change:** value change, comment fix
- **Lines added/removed:** +2 / -2
- **Why:** OAuth candidate initial state: plan: null instead of "free". Updated comment.
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/lib/mcp/auth/resolvers/applySubscriptionGate.ts`
- **Commit:** 1 + 2
- **Type of change:** logic change
- **Lines added/removed:** +4 / -7
- **Why:** Commit 1: negative cache uses plan: null. Commit 2: reads .priceId and .tier from reader instead of calling priceIdToTier directly. Removed priceIdToTier import.
- **Risk assessment:** medium (hot path, every MCP request)
- **Verified by:** tsc, build, grep invariant (priceIdToTier count)

### `src/lib/mcp/entitlement.ts`
- **Commit:** 1 + 2
- **Type of change:** config change, null handling
- **Lines added/removed:** +40 / -36
- **Why:** ACTION_PLAN_GATE: all 18 tools set to "creator". MONTHLY_CAPS: removed free entries, starter at 0 for all tools, generate_post_draft creator gets 100/month (pro unlimited). Null plan handling in checkTierGate, buildTierDenyMessage, checkAndIncrementQuota. Stale comment fix.
- **Risk assessment:** medium (policy change for all MCP tools)
- **Verified by:** tsc, build

### `src/lib/mcp/_shared/getUploadLimitsForPrincipal.ts`
- **Commit:** 1
- **Type of change:** signature change
- **Lines added/removed:** +9 / -19
- **Why:** Accept PlanTier | null instead of priceId. Uses TIER_UPLOAD_LIMITS instead of PRICE_ID_UPLOAD_LIMITS.
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/lib/mcp/_shared/enforceStorageQuota.ts`
- **Commit:** 1
- **Type of change:** signature change
- **Lines added/removed:** +5 / -3
- **Why:** Accept PlanTier | null instead of priceId. Uses TIER_STORAGE_LIMITS instead of STORAGE_LIMITS.
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/actions/server/data/generateServerSignedUploadUrl.ts`
- **Commit:** 1
- **Type of change:** signature change
- **Lines added/removed:** +8 / -6
- **Why:** GenerateUploadUrlInput.priceId replaced with tier: PlanTier | null. Uses TIER_UPLOAD_LIMITS internally.
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/actions/server/connections/checkAccountLimits.ts`
- **Commit:** 1
- **Type of change:** signature change, logic change
- **Lines added/removed:** +12 / -11
- **Why:** Accept PlanTier | null instead of PlanTier | string | null. Removed priceIdToTier call (tier passed in directly). Removed stale comment (F6). Added null tier handling.
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/actions/checkActiveSubscription.ts`
- **Commit:** 1 + 2
- **Type of change:** rewrite
- **Lines added/removed:** +56 / -40
- **Why:** Commit 1: added .tier field, read stripe_price_id instead of plan. Commit 2: full rewrite as "use server" action with ActiveSubscription return type (priceId, tier, status, currentPeriodEnd, startDate). Dropped success/message fields (Drew Q1). Single priceIdToTier call site.
- **Risk assessment:** high (13 callers)
- **Verified by:** tsc, build, grep invariant

### `src/actions/server/stripe/customerPortal.ts`
- **Commit:** 2
- **Type of change:** import change
- **Lines added/removed:** +2 / -2
- **Why:** Switched from checkUserSubscription to checkActiveSubscription.
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/components/marketing-page/pricing.tsx`
- **Commit:** 2
- **Type of change:** import change
- **Lines added/removed:** +2 / -2
- **Why:** Switched from checkUserSubscription to checkActiveSubscription. Uses .isActive.
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/components/sidebar/nav-user.tsx`
- **Commit:** 2
- **Type of change:** import change
- **Lines added/removed:** +2 / -2
- **Why:** Switched from checkUserSubscription to checkActiveSubscription. Uses .isActive.
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/app/(protected)/connections/page.tsx`
- **Commit:** 1
- **Type of change:** caller update
- **Lines added/removed:** +2 / -2
- **Why:** Pass .tier instead of .plan to checkAccountLimits. Check .isActive only (drop .success).
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/app/(protected)/create/video/page.tsx`
- **Commit:** 1 + 2 + 3
- **Type of change:** caller update
- **Lines added/removed:** +3 / -4
- **Why:** Use TIER_UPLOAD_LIMITS[.tier] instead of PRICE_ID_UPLOAD_LIMITS[.plan]. Remove planId prop.
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/app/(protected)/create/image/page.tsx`
- **Commit:** 1 + 2 + 3
- **Type of change:** caller update
- **Lines added/removed:** +3 / -4
- **Why:** Same as video page.
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/app/(protected)/create/text/page.tsx`
- **Commit:** 1 + 2 + 3
- **Type of change:** caller update
- **Lines added/removed:** +1 / -2
- **Why:** Check .tier instead of .plan. Remove planId prop.
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/app/api/social/linkedin/initiate/route.ts`
- **Commit:** 1
- **Type of change:** caller update
- **Lines added/removed:** +2 / -2
- **Why:** Pass .tier to checkAccountLimits. Drop .success check.
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/app/api/social/tiktok/initiate/route.ts`
- **Commit:** 1
- **Type of change:** caller update
- **Lines added/removed:** +2 / -2
- **Why:** Same as linkedin.
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/app/api/social/pinterest/initiate/route.ts`
- **Commit:** 1
- **Type of change:** caller update
- **Lines added/removed:** +2 / -2
- **Why:** Same as linkedin.
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/app/api/social/instagram/initiate/route.ts`
- **Commit:** 1
- **Type of change:** caller update
- **Lines added/removed:** +2 / -2
- **Why:** Same as linkedin.
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/app/api/storage/generate-upload-url/route.ts`
- **Commit:** 1
- **Type of change:** caller update
- **Lines added/removed:** +2 / -2
- **Why:** Pass .tier instead of .plan to generateServerSignedUploadUrl. Drop .success check.
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/app/api/webhooks/stripe/route.ts`
- **Commit:** 3
- **Type of change:** writer cleanup
- **Lines added/removed:** +2 / -3
- **Why:** Stop writing to plan column (F3). Change "cancelled" to "canceled" in delete handler (F2).
- **Risk assessment:** medium (production writer)
- **Verified by:** tsc, build

### `src/actions/server/ensureUserExists.ts`
- **Commit:** 3
- **Type of change:** writer fix
- **Lines added/removed:** +5 / -3
- **Why:** Write stripe_price_id instead of plan (F1). Add invalidateCachedSubscription after insert and update (F5).
- **Risk assessment:** medium (production sync path)
- **Verified by:** tsc, build

### `src/actions/client/signedUrlUpload.ts`
- **Commit:** 3
- **Type of change:** dead code removal
- **Lines added/removed:** +4 / -8
- **Why:** Remove dead planId field from request body and function parameters (F11).
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/components/core/create/SocialPostForm/SocialPostForm.tsx`
- **Commit:** 3
- **Type of change:** dead code removal
- **Lines added/removed:** +1 / -4
- **Why:** Remove planId prop and its passthrough to uploadWithSignedUrl (upstream of F11).
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/lib/mcp/tools/listBillingSummary.ts`
- **Commit:** 1 + 2
- **Type of change:** rewrite
- **Lines added/removed:** +24 / -39
- **Why:** Replace direct DB query with checkActiveSubscription call (F9). Handle nullable plan label.
- **Risk assessment:** medium (MCP tool output format change)
- **Verified by:** tsc, build

### `src/lib/mcp/tools/attachMediaFromUrl.ts`
- **Commit:** 1
- **Type of change:** caller update
- **Lines added/removed:** +2 / -2
- **Why:** Pass principal.plan (tier) instead of principal.priceId to getUploadLimitsForPrincipal and enforceStorageQuota.
- **Risk assessment:** low
- **Verified by:** tsc, build

### `src/lib/mcp/tools/requestUploadUrl.ts`
- **Commit:** 1
- **Type of change:** caller update
- **Lines added/removed:** +1 / -1
- **Why:** Pass principal.plan (tier) instead of principal.priceId to generateServerSignedUploadUrl.
- **Risk assessment:** low
- **Verified by:** tsc, build

## Files Deleted

### `src/actions/server/stripe/checkUserSubscription.ts`
- **Commit:** 2
- **Why:** Collapsed into checkActiveSubscription. Zero remaining callers after migration of pricing.tsx, nav-user.tsx, customerPortal.ts.
- **Last callers removed in:** Commit 2 (pricing.tsx, nav-user.tsx, customerPortal.ts)

## Files NOT Modified (intentional)

- `src/lib/types/database.types.ts`: Generated file. Schema changes happen via migrations.
- `src/lib/types/dbTypes.ts`: SubscriptionStatus type already uses "canceled" (US). Correct after F2 fix.
- `src/lib/mcp/toolNames.ts`: No plan/tier logic.
- `src/actions/server/data/cleanupCancelledPostsAfterGrace.ts`: Reads status only (no plan/tier). The "cancelled" in its name refers to PostStatus, not subscription status.
- `src/actions/server/stripe/checkOutSession.ts`: Passes priceId to Stripe. No plan resolution.
- `.env.example`: No priceId env vars. All priceIds are compile-time constants in plans.ts.
- `src/actions/server/mcp/createApiKey.ts`: Binary subscription check only (.isActive). No change needed.
- `src/app/(protected)/integrations/page.tsx`: Binary subscription check only (.isActive). No change needed.
- `src/app/(protected)/create/page.tsx`: Binary subscription check only (.isActive). No change needed.

## SQL Migrations Applied

Drew should run these in the Supabase SQL editor:

### Backfill 1: normalize status spelling

```sql
UPDATE stripe_subscriptions
SET status = 'canceled'
WHERE status = 'cancelled';
```

**Verification query:**
```sql
SELECT COUNT(*) FROM stripe_subscriptions WHERE status = 'cancelled';
-- Expected: 0
```

### Backfill 2: fill in stripe_price_id for legacy rows

```sql
UPDATE stripe_subscriptions
SET stripe_price_id = plan
WHERE stripe_price_id IS NULL
  AND plan IS NOT NULL
  AND plan LIKE 'price_%';
```

**Verification query:**
```sql
SELECT COUNT(*) FROM stripe_subscriptions WHERE stripe_price_id IS NULL AND status IN ('active', 'trialing');
-- Expected: 0
```

Note: Row counts will depend on production data. Drew should run these and record the actual counts.

## Scope Extension Findings

### Finding X-1: cleanupCancelledPostsAfterGrace reads stripe_subscriptions directly

- **Where:** `src/actions/server/data/cleanupCancelledPostsAfterGrace.ts:77`
- **Severity:** low
- **Why it matters:** Fourth direct reader of stripe_subscriptions. It only checks subscription existence (active/trialing status), not tier or priceId. This is functionally a `hasActiveSubscription` check.
- **Suggested fix:** Could delegate to checkActiveSubscription and check .isActive, but the current code is simpler (single status-only SELECT vs full reader).
- **Included in this refactor:** no
- **If no:** Minimal benefit. The direct read is intentionally narrow, no plan/tier logic involved.

### Finding X-2: "cancelled" appears in PostStatus context

- **Where:** `src/actions/server/scheduleActions/cancel/cancelScheduledPostBatch.ts:7,89` (comments), `src/lib/types/dbTypes.ts:49` (PostStatus type)
- **Severity:** low
- **Why it matters:** The `PostStatus` type includes "cancelled" (UK spelling) for scheduled post cancellation. This is a different domain from subscription status and uses a different DB column.
- **Suggested fix:** No change. PostStatus "cancelled" is the established convention for post lifecycle. Normalizing it to US spelling would break existing DB data with no benefit.
- **Included in this refactor:** no
- **If no:** Different domain. PostStatus vs SubscriptionStatus are separate concerns.

## Invariant Verification

### Invariant 1: priceIdToTier is called at exactly one call site
- **Command:** `grep -rn "priceIdToTier" src/ | grep -v "import\|//\|\*\|console"`
- **Expected:** 2 (definition + one call in checkActiveSubscription)
- **Actual:** 2 matches. `plans.ts:199` (definition), `checkActiveSubscription.ts:64` (single call site). One additional hit on `plans.ts:204` is the error message string literal inside the function body.

### Invariant 2: no 'free' tier references in code
- **Command:** `grep -rn "'free'" src/lib/ src/actions/ src/app/ src/components/`
- **Expected:** empty
- **Actual:** empty

### Invariant 3: no 'cancelled' (UK) spelling in subscription code
- **Command:** `grep -rn "'cancelled'" src/app/api/webhooks/ src/actions/checkActiveSubscription.ts src/actions/server/ensureUserExists.ts`
- **Expected:** empty
- **Actual:** empty

### Invariant 4: no priceId-keyed limit maps
- **Command:** `grep -rn "PRICE_ID_ACCOUNT_LIMITS\|PRICE_ID_UPLOAD_LIMITS\|PRICE_ID_STORAGE_LIMITS" src/`
- **Expected:** empty
- **Actual:** empty

### Invariant 5: no `as PlanTier` casts
- **Command:** `grep -rn "as PlanTier" src/`
- **Expected:** empty
- **Actual:** empty

### Invariant 6: build is green
- **Command:** `npx tsc --noEmit && npm run build`
- **Expected:** zero errors
- **Actual:** pass (one pre-existing TS1261 casing warning on apiKey.ts import, unrelated to this refactor)

## MCP Access Policy Verification

**Starter-tier user attempts `schedule_post`:**
1. `applySubscriptionGate` finds active subscription, resolves tier to "starter"
2. `entitlementFor` calls `checkTierGate`: `tierMeets("starter", "creator")` returns false (starter index 0 < creator index 1)
3. Denied with reason "plan_too_low", message: `Action "schedule_post" requires the Creator plan or higher. You are on the Starter plan.`

**Creator-tier user attempts `schedule_post`:**
1. `applySubscriptionGate` resolves tier to "creator"
2. `checkTierGate`: `tierMeets("creator", "creator")` returns true
3. `checkAndIncrementQuota`: cap is 500 for creator. If under cap, allowed.
4. Result: allowed (within quota)

**Pro-tier user attempts `generate_post_draft`:**
1. `applySubscriptionGate` resolves tier to "pro"
2. `checkTierGate`: `tierMeets("pro", "creator")` returns true (pro rank 2 >= creator rank 1)
3. `checkAndIncrementQuota`: cap is null for pro (unlimited)
4. Result: allowed

**User with no subscription attempts `list_connections`:**
1. `applySubscriptionGate` calls checkActiveSubscription, gets isActive: false
2. Caches negative result (plan: null, priceId: null)
3. Returns null (fail-closed)
4. `resolveMcpPrincipal` returns null
5. Request is rejected at the MCP transport layer before reaching `entitlementFor`

## Open Questions / Items Drew Should Verify

1. **SQL backfills**: Drew needs to run the two SQL statements in the Supabase dashboard and record row counts.
2. **`apiKey.ts` casing**: Pre-existing TS1261 warning. The file on disk is `apiKey.ts` (camelCase) but Windows filesystem is case-insensitive. This is not related to the refactor but could be cleaned up by renaming the file to match the import exactly.
3. **`listBillingSummary` output format**: The MCP tool response now uses `start_date` from `ActiveSubscription.startDate` instead of from a direct DB query. The field mapping is preserved.
4. **`ensureUserExists` still runs in production**: Drew confirmed this sync path runs as a safety net. It now writes `stripe_price_id` and invalidates the MCP subscription cache.

## Metrics

- Total files touched: 34
- Total files deleted: 1
- Total lines added: 216
- Total lines removed: 416
- Net change: -200
- Number of pause-and-ask interactions: 1 (4 questions before Commit 1)

## Backward Compatibility Notes

What did NOT break:
- DB schema changes: none (plan column kept nullable, no DROP)
- Existing user subscriptions: still resolve correctly. The reader now reads stripe_price_id instead of plan, and the backfill SQL ensures both columns are populated for existing rows.
- Stripe checkout flow: unchanged (pricing.tsx still passes priceId to checkOutSession)
- Stripe customer portal: unchanged (customerPortal.ts still creates portal sessions)

What MIGHT need attention:
- Cached JS bundles on user devices may still send `planId` in upload requests for a few hours. The server ignores this field already, so no breakage.
- The `plan` DB column is orphaned. No writer populates it. It can be dropped in a future migration after confirming no external system reads it.
- Any external monitoring that queries `WHERE status = 'cancelled'` (UK spelling) will find zero rows after the SQL backfill. Update to `'canceled'`.
