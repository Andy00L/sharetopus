# x402 pay-per-call implementation report

**Branch:** feat/x402-pay-per-call
**Date:** 2026-05-16
**Commit base:** cbf1ba0

## Summary

Built the complete x402 pay-per-call code path for Sharetopus. AI agents access 10 dedicated `/api/x402/*` HTTP endpoints, authenticate via X-PAYMENT header (signed wallet payment), and pay USDC per action on Base or Solana. No Stripe subscription, no Clerk session, no website account required.

The implementation centers on a shared middleware HOF (`x402PaidEndpoint`) that encapsulates the verify/settle/charge/refund lifecycle. Each route provides only action-specific logic (body parsing, action resolution, business logic handler). The charge lifecycle uses a 1-step INSERT pattern (status="settled" on creation) matching the existing register/connect routes, with status updates to "refunded" or "failed" on handler errors.

Not built: `analytics_query` and `storage_overage` routes (seeded in pricing_actions but no endpoint for MVP), wallet credits prepaid system (pay-per-call only), webhook push for payment events, `recurrence="monthly"` enforcement cron. Supabase RPC types not regenerated (CLI not linked in worktree).

## Files created

| File | Lines | Purpose |
|---|---|---|
| `src/lib/x402/middleware/x402PaidEndpoint.ts` | ~300 | HOF wrapping verify/settle/charge/refund/log pattern |
| `src/lib/x402/middleware/resolvePostAction.ts` | ~30 | Maps post_type to pricing_actions key |
| `src/lib/x402/charges/insertX402Charge.ts` | ~85 | Single INSERT into x402_charges with status="settled" |
| `src/lib/storage/getUserStorageBytes.ts` | ~37 | Wraps get_user_storage_bytes RPC (neutral location) |
| `src/lib/x402/storage/enforceWalletStorageQuota.ts` | ~60 | Wallet-specific storage enforcement |
| `src/app/api/x402/post-now/route.ts` | ~115 | POST: direct post via directPostBatch |
| `src/app/api/x402/schedule/route.ts` | ~130 | POST: schedule via schedulePostBatch |
| `src/app/api/x402/upload-url/route.ts` | ~100 | POST: mint signed upload URL |
| `src/app/api/x402/reauth/route.ts` | ~165 | POST: re-auth expired OAuth connection |
| `src/app/api/x402/reschedule/route.ts` | ~85 | POST: reschedule via updateScheduledTimeBatch |
| `src/app/api/x402/cancel/route.ts` | ~80 | POST: cancel via cancelScheduledPostBatch |
| `src/app/api/x402/delete/route.ts` | ~80 | POST: delete via deleteScheduledPostBatch |
| `src/app/api/x402/connections/route.ts` | ~80 | GET: list social accounts (safe projection) |
| `src/app/api/x402/scheduled-posts/route.ts` | ~110 | GET: list scheduled posts |
| `src/app/api/x402/history/route.ts` | ~105 | GET: list content history |
| `src/inngest/functions/cleanupSiweNoncesCron.ts` | ~65 | Every 6h: purge expired/used SIWE nonces |
| `src/inngest/functions/cleanupX402AccessLogCron.ts` | ~50 | Daily 06:00 UTC: purge x402_access_log > 90 days |
| `x402_pricing_actions_seed.sql` | ~18 | 12 new pricing_actions rows (idempotent) |
| `.env.example` | +8 | 5 new x402 OAuth env vars added |

## Files modified

| File | Lines changed | Purpose of change |
|---|---|---|
| `src/lib/types/plans.ts` | +3 | Added `WALLET_STORAGE_LIMIT` constant (5 GB, independent) |
| `src/lib/mcp/_shared/enforceStorageQuota.ts` | ~15 | Refactored to call `getUserStorageBytes()` (no policy change) |
| `src/lib/x402/responses/buildSuccessResponse.ts` | +20 | Renamed to `buildRegisterSuccessResponse`, added `buildGenericSuccessResponse` |
| `src/lib/x402/responses/buildErrorResponse.ts` | +30 | Renamed to `buildRegisterErrorResponse`, added `buildGenericErrorResponse` |
| `src/app/api/x402/register/route.ts` | 2 | Updated imports to renamed builders |
| `src/app/api/inngest/route.ts` | +4 | Registered 2 new cleanup crons |
| `docs/ROADMAP.md` | ~10 | Updated x402 section from "schema-only" to "implemented" |
| `docs/BILLING.md` | ~40 | Replaced "Future: x402 (deferred)" with pricing table + refund policy |
| `docs/AUTH.md` | ~30 | Replaced "Future: wallet authentication (deferred)" with implementation docs |

## Files investigated but not changed

| File | Reason |
|---|---|
| `src/actions/server/scheduleActions/schedule/schedulePostBatch.ts` | Already accepts `CreatedVia` (includes "x402"). No change needed. |
| `src/actions/server/directPostActions/directPostBatch.ts` | Same. |
| `src/actions/server/scheduleActions/reschedule/updateScheduledTimeBatch.ts` | Same. |
| `src/actions/server/scheduleActions/cancel/cancelScheduledPostBatch.ts` | Same. |
| `src/actions/server/scheduleActions/delete/deleteScheduledPostBatch.ts` | Same. |
| `src/inngest/functions/processDirectPostHelpers.ts` | Accepts "x402" via CreatedVia union. |
| `src/inngest/functions/processSinglePostHelpers.ts` | Same. |
| `src/actions/server/contentHistoryActions/storeContentHistory.ts` | Same. |
| `src/actions/server/contentHistoryActions/storeFailedPost.ts` | Same. |
| `src/lib/x402/register/insertRegisterAtomic.ts` | Uses raw PostgREST fetch. Supabase CLI not linked, RPC regen skipped. |
| `src/lib/x402/connect/insertConnectAtomic.ts` | Same. |

## Routes added

| Method | Path | Action | Pricing | Refundable on handler fail |
|---|---|---|---|---|
| POST | /api/x402/post-now | post.text/image/video | $0.50-$1.00 | yes |
| POST | /api/x402/schedule | post.text/image/video | $0.50-$1.00 | yes |
| POST | /api/x402/upload-url | upload_url | $0.10 | yes |
| POST | /api/x402/reauth | connect_account | $0.50 | yes |
| POST | /api/x402/reschedule | reschedule | $0.10 | yes |
| POST | /api/x402/cancel | cancel | $0.001 | yes |
| POST | /api/x402/delete | delete | $0.001 | yes |
| GET | /api/x402/connections | list_connections | $0.001 | yes |
| GET | /api/x402/scheduled-posts | list_posts | $0.001 | yes |
| GET | /api/x402/history | list_history | $0.001 | yes |

## Schema changes

None to live DB. Seed SQL at `/x402_pricing_actions_seed.sql` must be run manually by Drew.

## Build status

- `npx tsc --noEmit`: PASS (0 errors)
- `next build`: Compiled successfully (9.0s). Pre-existing runtime errors from missing Supabase env vars during page data collection (not related to x402 changes).

## Invariant grep results

| Pattern | Hit count | Status |
|---|---|---|
| `: any` or `as unknown as` in x402 code | 0 | PASS |
| em-dash in x402 code | 0 | PASS |
| `throw new` in route handlers | 0 | PASS |
| hardcoded prices (executable code) | 0 | PASS (comment-only mentions in JSDoc) |
| payment/signature console.log | 0 in new code | PASS (1 pre-existing in refundSolana.ts logs tx sig) |
| git ops in code | 0 | PASS |

## Phase C verification result

Phase C: zero code changes required. All 4 downstream files already accept "x402" via the existing `CreatedVia` union type (`"web" | "mcp" | "x402" | "api"`):
- `src/inngest/functions/processDirectPostHelpers.ts`
- `src/inngest/functions/processSinglePostHelpers.ts`
- `src/actions/server/contentHistoryActions/storeContentHistory.ts`
- `src/actions/server/contentHistoryActions/storeFailedPost.ts`

## Known gaps / future work

- `analytics_query` and `storage_overage` actions seeded but no routes (deferred).
- `usdc_fmv_daily` orphan table still unpopulated (tax/compliance, not MVP).
- `wallet_credits` and `wallet_credits_ledger` unused (no prepaid system, pay-per-call only).
- No webhook for payment events (agents poll, no push).
- `recurrence="monthly"` is informational, no enforcement cron.
- Supabase RPC types not regenerated (CLI not linked). `register_wallet_atomic` and `connect_wallet_atomic` still use raw PostgREST fetch.

## Known limitations

1. **Charge insert failure post-settle cannot record x402_refunds row.** When `insertX402Charge` fails after on-chain settlement, a refund is issued but cannot be logged in `x402_refunds` because `charge_id` is a NOT NULL FK and no charge row exists. The refund is recorded in the audit log (`x402_access_log`) and the on-chain `refundTxHash` is returned in the error response for manual reconciliation.

2. **No retry logic on insertX402Charge.** A transient Supabase error triggers an immediate refund. Future improvement: 2-3 attempts with exponential backoff before refunding. The only irrecoverable failure is unique constraint violation on nonce or request_id (which should not happen with properly generated nonces).

## Manual steps Drew must do

1. Run `/x402_pricing_actions_seed.sql` against prod and dev Supabase.
2. Set the 5 new env vars in Vercel + local `.env`:
   - `X402_HMAC_SECRET` (generate via `openssl rand -hex 32`)
   - `X402_LINKEDIN_REDIRECT_URI`
   - `X402_TIKTOK_REDIRECT_URI`
   - `X402_PINTEREST_REDIRECT_URI`
   - `X402_INSTAGRAM_REDIRECT_URI`
3. Run `npx supabase gen types typescript --linked > src/lib/types/database.types.ts` to type the 2 RPCs (`register_wallet_atomic`, `connect_wallet_atomic`). Then refactor `insertRegisterAtomic.ts` and `insertConnectAtomic.ts` to use typed `adminSupabase.rpc()` calls.
4. Verify the 2 Inngest cleanup crons appear in the Inngest dashboard after deploy.
5. Smoke-test one route end-to-end (e.g. `/api/x402/post-now`) against base-sepolia testnet.
6. Copy the updated `.env.example` from the worktree to the main checkout (it is gitignored).

## Open questions for Drew

- None. All decisions were pre-locked in the prompt and subsequent approvals.
