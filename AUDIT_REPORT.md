# Sharetopus Codebase Audit

Date: 2026-05-08
Branch: main
Last commit: 43014d8 feat(inngest): fan-out worker for scheduled posts (FIX 13)
Auditor: Claude Code (read-only)

## Executive summary

Sharetopus has two active pipelines for posting social content: the web UI path (handleSocialMediaPost, which dispatches via server-to-self HTTP fetch calls) and the new Inngest fan-out path (scheduledPostsTick + processSinglePost). Both converge on the same four `directPostFor{Platform}Accounts` functions. The old cron route (`/api/cron/process-scheduled-posts`) has been deleted from the codebase but the external Supabase pg_cron job and Edge Function that called it may still be active (operator must confirm).

The production `authCheck Expected: "null"` failure is caused by `handleSocialMediaPost` calling `authCheck(userId)` inside a Clerk session context where `auth()` returns null. This happens when `scheduleForPinterestAccount` (called from within `/api/social/pinterest/process`) delegates to the public `schedulePost` wrapper, which calls `authCheck`. The `/process` route was reached via a `fetch()` call that does not forward cookies, so Clerk has no session.

Eight API routes (`/api/social/{platform}/process` and `/api/social/{platform}/post` for all four platforms) have zero authentication at the route level. The `/api/storage/generate-view-url` route also has zero authentication and generates signed Supabase storage URLs for any path.

The Pinterest "invalid URL" error occurs when Pinterest's servers try to fetch a Supabase signed URL. The URL format and TTL (300s) appear correct in code. Root cause cannot be determined from source alone (may be Supabase CDN, URL encoding, or timing).

## Repo state

```
Branch: main (clean working tree)
Last 25 commits:
43014d8 feat(inngest): fan-out worker for scheduled posts (FIX 13)
02614b6 fix(mcp): map Stripe price IDs to plan tiers in entitlement gate
33fa69e fix(mcp): set serverInfo so clients show 'Sharetopus' in UI
b20f7e5 fix(mcp): 8 robustness fixes + bulk_schedule refactor
36079a0 update
21f16c6 fix: align mcp-handler basePath with route file location
e5e212c fix: MCP hardening round 2 (storage cleanup + subscription gate)
19a85e6  mcp , implementtions
2d5509b fix
b6803da merge: dual-track schema (Phase 1a)
3e83515 refactor: migrate to principals supertype + new schema (Phase 1a)
fce90f5 chore: add schema migrations + database types
3183b97 docs: add demo video link to README Live Demo section
c9eaa92 Add TestSprite HTML test report
a71f1a4 docs: add complete TestSprite test report with bug findings and fix verification
a4a5ff9 remove sensitive config files, update gitignore
c7c5de5 update
76391f8 docs: fix screenshot paths, remove em dashes, update docs for recent code changes
3d926e7 docs: add AI-Powered Testing with TestSprite section to README
19e5358 Add 4 new TestSprite test cases (TC048-TC051): dark mode, rate limit, paywall, upload limit
6156d02 Add TestSprite AI-generated frontend test suite (13/15 pass)
7e068e8 fix: protect /connections route in middleware and make reschedule dialog inline
7e4567e update
7812863 fix: correct is_availble typo to is_available in all connect routes
5951e6a fix: upgrade @clerk/nextjs to v7 for Next.js 16 compatibility
```

Key versions (from package.json):
- Next.js: 16.1.6
- React: 19.2.0
- inngest: ^4.3.0 (resolved 4.3.0)
- mcp-handler: ^1.1.0
- @supabase/supabase-js: ^2.105.3
- @clerk/nextjs: ^7.3.2
- stripe: ^18.5.0

Migrations (chronological):
1. `20260506000001_initial_schema.sql` -- full schema creation
2. `20260507000001_atomic_increment_quota.sql` -- RPC for MCP quota counter
3. `20260508000001_add_queued_status_to_scheduled_posts.sql` -- adds 'queued' to status CHECK

Deleted from repo: `src/app/api/cron/process-scheduled-posts/route.ts` (FIX 13)
Not in repo: `supabase/functions/` directory (Edge Function deployed separately)
vercel.json: has `maxDuration: 60` for `src/app/api/direct/**/*.ts` but NO cron entries.

## Inventory

### Routes (Next.js App Router)

| Route | Methods | Auth model | Summary |
|-------|---------|-----------|---------|
| `/api/inngest` | GET, POST, PUT | Inngest signature (SDK-managed) | Inngest serve endpoint for scheduledPostsTick + processSinglePost |
| `/api/mcp/[transport]` | GET, POST | API key hash or OAuth JWT (withMcpAuth) | MCP protocol server (Streamable HTTP and SSE) |
| `/api/social/pinterest/process` | POST | **NONE** | Dispatches to schedule or direct-post per Pinterest account |
| `/api/social/pinterest/post` | POST | **NONE** | Calls directPostForPinterestAccounts |
| `/api/social/pinterest/connect` | GET | Clerk (auth()) | OAuth callback for Pinterest |
| `/api/social/pinterest/initiate` | GET | Clerk (auth()) | Start Pinterest OAuth flow |
| `/api/social/linkedin/process` | POST | **NONE** | Dispatches to schedule or direct-post per LinkedIn account |
| `/api/social/linkedin/post` | POST | **NONE** | Calls directPostForLinkedInAccounts |
| `/api/social/linkedin/connect` | GET | Clerk (auth()) | OAuth callback for LinkedIn |
| `/api/social/linkedin/initiate` | GET | Clerk (auth()) | Start LinkedIn OAuth flow |
| `/api/social/tiktok/process` | POST | **NONE** | Dispatches to schedule or direct-post per TikTok account |
| `/api/social/tiktok/post` | POST | **NONE** | Calls directPostForTikTokAccounts |
| `/api/social/tiktok/connect` | GET | Clerk (auth()) | OAuth callback for TikTok |
| `/api/social/tiktok/initiate` | GET | Clerk (auth()) | Start TikTok OAuth flow |
| `/api/social/instagram/process` | POST | **NONE** | Dispatches to schedule or direct-post per Instagram account |
| `/api/social/instagram/post` | POST | **NONE** | Calls directPostForInstagramAccounts |
| `/api/social/instagram/connect` | GET | Clerk (auth()) | OAuth callback for Instagram |
| `/api/social/instagram/initiate` | GET | Clerk (auth()) | Start Instagram OAuth flow |
| `/api/storage/generate-upload-url` | POST | Clerk (auth()) | Generates signed upload URL for scheduled-videos bucket |
| `/api/storage/generate-view-url` | POST | **NONE** | Generates signed view URL for scheduled-videos bucket |
| `/api/media` | GET | **NONE** (query params only) | Proxy for TikTok to pull media from Supabase |
| `/api/webhooks/clerk` | POST | Svix signature verification | Handles user.created, user.updated, user.deleted |
| `/api/webhooks/stripe` | POST | Stripe signature verification | Handles subscription and invoice events |
| `/api/auth/*` | Various | Clerk SDK | Clerk auth routes |

### Server actions (top-level exports)

| File | Function | Auth | Summary |
|------|----------|------|---------|
| `src/actions/server/scheduleActions/schedulePost.ts` | `schedulePost` | authCheck(userId) | Wraps schedulePostInternal |
| `src/actions/server/scheduleActions/cancelScheduledPost.ts` | `cancelScheduledPostBatch` | authCheck(userId) | Wraps cancelScheduledPostBatchInternal |
| `src/actions/server/scheduleActions/deleteScheduledPost.ts` | `deleteScheduledPostBatch` | authCheck or authCheckCronJob | Wraps deleteScheduledPostBatchInternal |
| `src/actions/server/scheduleActions/getScheduledPosts.ts` | `getScheduledPosts` | authCheck(userId) | Wraps getScheduledPostsInternal |
| `src/actions/server/scheduleActions/resumeScheduledPost.ts` | `resumeScheduledPostBatch` | authCheck(userId) | Wraps resumeScheduledPostBatchInternal |
| `src/actions/server/scheduleActions/updateScheduledTime.ts` | `updateScheduledTimeBatch` | authCheck(userId) | Wraps updateScheduledTimeBatchInternal |
| `src/actions/server/data/deleteSupabaseFileAction.ts` | `deleteSupabaseFileAction` | authCheck or authCheckCronJob | Wraps deleteSupabaseFileActionInternal |
| `src/actions/server/data/fetchSocialAccounts.ts` | `fetchSocialAccounts` | authCheck(userId) | Fetches social accounts for a user |
| `src/actions/server/contentHistoryActions/storeContentHistory.ts` | `storeContentHistory` | None (trusts caller) | Inserts into content_history |
| `src/actions/server/contentHistoryActions/storeFailedPost.ts` | `storeFailedPost` | None (trusts caller) | Inserts into failed_posts |
| `src/actions/server/contentHistoryActions/getContentHistory.ts` | `getContentHistory` | authCheck(userId) | Reads from content_history |
| `src/actions/server/stripe/checkOutSession.ts` | `checkOutSession` | authCheck via auth() | Creates Stripe checkout session |
| `src/actions/server/stripe/customerPortal.ts` | `createCustomerPortal` | authCheck via auth() | Creates Stripe customer portal session |
| `src/actions/server/stripe/checkUserSubscription.ts` | `checkUserSubscription` | authCheck(userId) | Checks subscription status (includes past_due) |
| `src/actions/server/accounts/disconnectSocialAccount.ts` | `disconnectSocialAccount` | authCheck(userId) | Removes social account |
| `src/actions/server/mcp/createApiKey.ts` | `createApiKey` | authCheck(userId) | Creates MCP API key |
| `src/actions/server/mcp/listApiKeys.ts` | `listApiKeys` | authCheck(userId) | Lists MCP API keys |
| `src/actions/server/mcp/revokeApiKey.ts` | `revokeApiKey` | authCheck(userId) | Revokes MCP API key |
| `src/components/core/create/action/handleSocialMediaPost/handleSocialMediaPost.ts` | `handleSocialMediaPost` | authCheck or authCheckCronJob | Main post-now and schedule orchestrator (web UI only) |

### MCP tools (count: 14)

| Tool | Plan gate | Quota action | Summary |
|------|-----------|-------------|---------|
| `list_connections` | free | -- | Lists social accounts |
| `list_scheduled_posts` | free | -- | Reads scheduled_posts |
| `list_content_history` | free | -- | Reads content_history |
| `list_billing_summary` | free | -- | Reads stripe_subscriptions + usage_quotas |
| `request_account_reauth_link` | free | -- | Returns OAuth re-auth URL |
| `attach_media_from_url` | starter | -- | Fetches URL, uploads to Supabase Storage |
| `schedule_post` | starter | schedule_post (10/100/500/unlimited) | Inserts into scheduled_posts via schedulePostInternal |
| `cancel_scheduled_posts` | starter | -- | Updates status to 'cancelled' |
| `resume_scheduled_posts` | starter | -- | Updates status back to 'scheduled' |
| `reschedule_posts` | starter | -- | Updates scheduled_at |
| `delete_scheduled_posts` | starter | -- | Deletes rows + cleans media |
| `bulk_schedule` | creator | bulk_schedule (0/0/200/unlimited) | Bulk upsert into scheduled_posts |
| `get_account_analytics` | creator | -- | Reads analytics_metrics |
| `generate_post_draft` | pro | generate_post_draft (0/0/0/100) | Returns prompt (no LLM call) |

MCP resources: 3 (connections, scheduled-posts, content-history). All gated by entitlementFor() despite a misleading comment in `resources/index.ts:12` saying they are not. Resources do NOT audit-log.

MCP prompts: 3 (plan_week_for_platform, repurpose_post, audit_calendar). Pure message templates. No auth, no DB, no audit.

### Inngest functions

| Function ID | Trigger | Retries | Concurrency | Summary |
|-------------|---------|---------|-------------|---------|
| `scheduled-posts-tick` | `cron: "* * * * *"` | 0 | limit: 1 | Dispatcher: queries due scheduled_posts, emits post.due events, marks rows queued |
| `process-single-post` | `event: "post.due"` | 3 (configurable) | limit: 5 (configurable), throttle: 5/min per social_account_id | Worker: claims row, mints URL, calls directPostFor*Accounts, records status |

Source: `src/inngest/functions/scheduledPostsTick.ts:14-21`, `src/inngest/functions/processSinglePost.ts:32-44`

### Cron / scheduled triggers (full picture)

| Source | Schedule | Target | In code? | Operator must confirm |
|--------|----------|--------|----------|----------------------|
| Inngest Cloud | `* * * * *` | scheduled-posts-tick function | Yes (`scheduledPostsTick.ts:20`) | Confirm Inngest dashboard shows "Synced" |
| Supabase pg_cron | Unknown | Supabase Edge Function or direct HTTP | No (not in migrations) | **Must run SQL query below** |
| Supabase Edge Function | Triggered by pg_cron | `POST /api/cron/process-scheduled-posts` (deleted) | No (no supabase/functions/ dir) | **Must check Supabase dashboard** |
| Vercel cron | None | N/A | No entries in vercel.json | N/A |

### Database tables (posting-relevant subset)

| Table | Who reads | Who writes | Idempotency key |
|-------|-----------|-----------|-----------------|
| `scheduled_posts` | Inngest tick, web UI, MCP tools, MCP resources | Web UI schedule actions, MCP tools, Inngest worker (status updates) | `principal_id + idempotency_key` (partial unique index, NULL keys exempt) |
| `failed_posts` | Web UI | directPostFor*Accounts (isCronJob=true), Inngest recordPostStatus (via directPostFor*) | None |
| `content_history` | Web UI, MCP resource, MCP tool | directPostFor*Accounts (on success), storeContentHistory | None |
| `social_accounts` | All paths | OAuth connect routes, Clerk webhook (cascade delete) | `principal_id + platform + account_identifier` (unique) |
| `stripe_subscriptions` | MCP auth, checkActiveSubscription, checkUserSubscription | Stripe webhook handler | `stripe_subscription_id` |
| `usage_quotas` | MCP entitlement | atomic_increment_quota RPC | `principal_id + period + action` (unique) |
| `mcp_audit_log` | -- | MCP audit.ts (logToolCall) | None |

### External services

| Service | Where called | Auth method |
|---------|-------------|-------------|
| Pinterest API v5 | postImage.ts, createVideoPin.ts | Bearer token (per-account access_token) |
| LinkedIn UGC API | postToLinkedIn.ts | Bearer token (per-account access_token) |
| TikTok Content Posting API | postToTikTok.ts | Bearer token (per-account access_token) |
| Instagram Graph API v23.0 | postToInstagram.ts | Bearer token (per-account access_token) |
| Supabase Storage | Multiple (signed URL, upload, delete) | Service role key (adminSupabase) |
| Supabase PostgREST | Multiple | Service role key (adminSupabase) or anon key |
| Stripe API | Webhook handler, checkout, portal | STRIPE_SECRET_KEY |
| Clerk | auth(), webhook handler | CLERK_SECRET_KEY (SDK-managed) |
| Upstash Redis | checkRateLimit.ts | UPSTASH_REDIS_REST_URL + TOKEN |
| Inngest Cloud | serve endpoint | INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY (SDK-managed) |

## Entry points

### Web UI: Post Now (direct post)

```
ENTRY: handleSocialMediaPost (direct)
TRIGGER: User clicks "Post" in SocialPostForm
AUTH: authCheck(userId) -- Clerk session
CALL CHAIN:
  1. src/components/core/create/SocialPostForm.tsx:720 -- calls handleSocialMediaPost
  2. src/components/core/create/action/handleSocialMediaPost/handleSocialMediaPost.ts:149 -- authCheck
  3. handleSocialMediaPost.ts:170 -- checkRateLimit
  4. handleSocialMediaPost.ts:297 -- createSecureMediaUrlSigned (TikTok) or getSignedViewUrl (others)
  5. handleSocialMediaPost.ts:349-441 -- fetch() to /api/social/{platform}/process (4 in parallel)
  6. src/app/api/social/{platform}/process/route.ts -- delegates to process{Platform}Accounts
  7. src/lib/api/{platform}/processAccounts/process{Platform}Accounts.ts -- for each account:
     a. If isScheduled=false: fetch() to /api/social/{platform}/post
     b. src/app/api/social/{platform}/post/route.ts -- calls directPostFor{Platform}Accounts
  8. src/lib/api/{platform}/post/directPostFor{Platform}Accounts.ts -- posts to platform API
DB WRITES: content_history (on success via storeContentHistory)
DB READS: social_accounts (via ensureValidToken in directPostFor*)
EXTERNAL CALLS: Pinterest/LinkedIn/TikTok/Instagram APIs, Supabase Storage (signed URL)
ON SUCCESS: content_history row inserted, media file cleaned up (30s delay for IG/TikTok)
ON FAILURE: Error returned to SocialPostForm. No failed_posts row (isCronJob=false)
```

### Web UI: Schedule post

```
ENTRY: handleSocialMediaPost (schedule)
TRIGGER: User clicks "Schedule" in SocialPostForm
AUTH: authCheck(userId) -- Clerk session
CALL CHAIN:
  1. src/components/core/create/SocialPostForm.tsx:720 -- calls handleSocialMediaPost(isScheduled=true)
  2. handleSocialMediaPost.ts:149 -- authCheck
  3. handleSocialMediaPost.ts:296,310 -- signed URL minting SKIPPED (isScheduled check)
  4. handleSocialMediaPost.ts:349-441 -- fetch() to /api/social/{platform}/process
  5. src/lib/api/{platform}/processAccounts/process{Platform}Accounts.ts -- isScheduled=true branch:
     a. Calls scheduleFor{Platform}Account(s)
  6. src/lib/api/{platform}/schedule/scheduleFor{Platform}Account(s).ts:
     a. Calls schedulePost(scheduleData, userId)
  7. src/actions/server/scheduleActions/schedulePost.ts:31 -- authCheck(userId) **CALLED AGAIN**
  8. src/actions/server/_internal/scheduleActions/schedulePost.ts -- INSERT into scheduled_posts
DB WRITES: scheduled_posts (INSERT with status='scheduled')
DB READS: social_accounts (ownership check in schedulePostInternal)
EXTERNAL CALLS: None (scheduling only inserts a row)
ON SUCCESS: scheduled_posts row created, no media cleanup
ON FAILURE: Error returned to SocialPostForm
KNOWN PRODUCTION ISSUE: authCheck at step 7 fails with Expected:"null" because the fetch at
  step 4 does not forward cookies, so Clerk auth() returns null in the /process route context.
```

### Inngest: Scheduled posts dispatcher

```
ENTRY: scheduledPostsTick
TRIGGER: Inngest cron, every minute (* * * * *)
AUTH: Inngest signature verification (SDK-managed)
CALL CHAIN:
  1. src/inngest/functions/scheduledPostsTick.ts:23 -- step "fetch-due-posts"
  2. src/inngest/functions/scheduledPostsTickHelpers.ts:20 -- fetchDueScheduledPosts
     SELECT from scheduled_posts WHERE status='scheduled' AND scheduled_at <= now()
  3. scheduledPostsTick.ts:53 -- step "dispatch-due-posts" (sendEvent)
  4. scheduledPostsTick.ts:55 -- step "mark-queued"
  5. scheduledPostsTickHelpers.ts:56 -- markPostsAsQueued
     UPDATE SET status='queued' WHERE id IN (...) AND status='scheduled'
DB WRITES: scheduled_posts (UPDATE status to 'queued')
DB READS: scheduled_posts (status='scheduled', scheduled_at <= now)
EXTERNAL CALLS: Inngest event bus (sendEvent)
ON SUCCESS: Events dispatched, rows marked 'queued'
ON FAILURE: retries=0, single run; next tick in 60s picks up missed rows
```

### Inngest: Single post worker

```
ENTRY: processSinglePost
TRIGGER: Inngest event "post.due"
AUTH: Inngest signature verification (SDK-managed); no Clerk session
CALL CHAIN:
  1. src/inngest/functions/processSinglePost.ts:48 -- step "fetch-post-and-account"
  2. processSinglePostHelpers.ts:43 -- fetchPostAndAccount (SELECT scheduled_posts + social_accounts)
  3. processSinglePost.ts:59 -- checkPlatformCompatibility (inline, not a step)
  4. processSinglePost.ts:69 -- step "claim-and-fail-incompatible" (if incompatible)
     OR
  5. processSinglePost.ts:82 -- step "claim-post"
     processSinglePostHelpers.ts:113 -- UPDATE SET status='processing' WHERE status IN ('scheduled','queued')
  6. processSinglePost.ts:89 -- step "build-signed-urls"
     processSinglePostHelpers.ts:157 -- getSignedViewUrl or createSecureMediaUrlSigned
  7. processSinglePost.ts:106 -- step "call-platform-direct-post"
     processSinglePostHelpers.ts:268 -- callPlatformDirectPost -> directPostFor{Platform}Accounts
  8. processSinglePost.ts:117 -- step "record-status"
     processSinglePostHelpers.ts:465 -- UPDATE scheduled_posts SET status='posted' or 'failed'
  9. processSinglePost.ts:126 -- step "cleanup-storage"
     processSinglePostHelpers.ts:545 -- deleteSupabaseFileActionInternal
DB WRITES: scheduled_posts (status transitions), content_history (via directPostFor*), failed_posts (via directPostFor* when isCronJob=true)
DB READS: scheduled_posts, social_accounts
EXTERNAL CALLS: Platform APIs (Pinterest/LinkedIn/TikTok/Instagram), Supabase Storage
ON SUCCESS: scheduled_posts.status='posted', content_history row, media cleaned up
ON FAILURE (terminal): scheduled_posts.status='failed', failed_posts row
ON FAILURE (retryable): Inngest retries up to 3 times with exponential backoff
```

### MCP: schedule_post tool

```
ENTRY: schedule_post MCP tool
TRIGGER: MCP client calls tool via /api/mcp/[transport]
AUTH: API key (stp_mcp_ prefix, SHA-256 hash lookup) or OAuth JWT
CALL CHAIN:
  1. src/lib/mcp/tools/schedulePost.ts -- extractPrincipal, entitlementFor("schedule_post")
  2. schedulePost.ts:69 -- schedulePostInternal(data, principal.principalId)
  3. src/actions/server/_internal/scheduleActions/schedulePost.ts -- INSERT into scheduled_posts
DB WRITES: scheduled_posts (INSERT), usage_quotas (via atomic_increment_quota), mcp_audit_log
DB READS: social_accounts (ownership), scheduled_posts (duplicate check)
EXTERNAL CALLS: None
ON SUCCESS: Row inserted, audit logged, quota incremented
ON FAILURE: Error response, audit logged with status "error"
```

### MCP: bulk_schedule tool

```
ENTRY: bulk_schedule MCP tool
TRIGGER: MCP client calls tool
AUTH: API key or OAuth JWT; plan >= creator
CALL CHAIN:
  1. src/lib/mcp/tools/bulkSchedule.ts -- extractPrincipal, entitlementFor("bulk_schedule")
  2. bulkSchedule.ts:582 -- preflight: platform daily quota check (platform_quotas table)
  3. bulkSchedule.ts:597 -- account ownership check (single SELECT)
  4. bulkSchedule.ts:329 -- upsert into scheduled_posts with ON CONFLICT DO NOTHING (idempotency_key)
  5. bulkSchedule.ts:363-387 -- follow-up SELECT for skipped (already-existing) rows
DB WRITES: scheduled_posts (upsert), usage_quotas, mcp_audit_log
DB READS: social_accounts, scheduled_posts, platform_quotas
```

### Webhook: Clerk

```
ENTRY: /api/webhooks/clerk
TRIGGER: Clerk user lifecycle events
AUTH: Svix signature verification (CLERK_WEBHOOK_SECRET)
EVENTS:
  user.created -> INSERT principals + users + Stripe customer create
  user.updated -> UPDATE users + Stripe customer update
  user.deleted -> DELETE users + Stripe customer delete + Storage folder delete
DB WRITES: principals, users, stripe_subscriptions (cascade from users)
EXTERNAL CALLS: Stripe (customer create/delete/update), Supabase Storage (folder delete on user.deleted)
```

### Webhook: Stripe

```
ENTRY: /api/webhooks/stripe
TRIGGER: Stripe subscription and invoice events
AUTH: stripe.webhooks.constructEventAsync (STRIPE_WEBHOOK_SECRET)
EVENTS:
  customer.subscription.created -> INSERT stripe_subscriptions
  customer.subscription.updated -> UPDATE stripe_subscriptions
  customer.subscription.deleted -> UPDATE stripe_subscriptions.status='cancelled'
  invoice.payment_succeeded -> INSERT stripe_invoices
  invoice.payment_failed -> INSERT stripe_invoices
DB WRITES: stripe_subscriptions, stripe_invoices
```

### MCP: cancel_scheduled_posts / resume_scheduled_posts / reschedule_posts / delete_scheduled_posts

All follow the same pattern:
```
ENTRY: MCP tool
AUTH: API key or OAuth JWT; plan >= starter
CALL CHAIN:
  1. Extract principal, check entitlement
  2. Call *Internal function with principal.principalId
  3. Internal function checks ownership at data level, performs UPDATE/DELETE
DB WRITES: scheduled_posts
```

### MCP: list_connections / list_scheduled_posts / list_content_history / list_billing_summary

All follow the same pattern:
```
ENTRY: MCP tool
AUTH: API key or OAuth JWT; plan >= free
CALL CHAIN:
  1. Extract principal, check entitlement
  2. SELECT from relevant table WHERE principal_id = ...
DB WRITES: mcp_audit_log only
```

### MCP: attach_media_from_url

```
ENTRY: attach_media_from_url MCP tool
AUTH: API key or OAuth JWT; plan >= starter
CALL CHAIN:
  1. Extract principal, check entitlement
  2. Validate URL scheme (HTTP/HTTPS only)
  3. Fetch URL content
  4. Upload to Supabase Storage (scheduled-videos bucket)
DB WRITES: mcp_audit_log
EXTERNAL CALLS: HTTP fetch (user-provided URL), Supabase Storage upload
SECURITY NOTE: No SSRF protection against internal/private IPs
```

### Web UI: Cancel / Resume / Reschedule / Delete scheduled posts

All follow the same pattern:
```
ENTRY: BatchedPostCard or PostsGrid component
AUTH: authCheck(userId) in public wrapper
CALL CHAIN:
  1. Component calls public wrapper (e.g., cancelScheduledPostBatch)
  2. Public wrapper: authCheck(userId), checkRateLimit, then *Internal function
  3. Internal function: ownership check at data level, UPDATE/DELETE
DB WRITES: scheduled_posts (and Storage on delete)
```

## Subsystem deep-dives

### MCP server

**Auth flow (src/lib/mcp/auth.ts):**

1. Bearer token arrives at `/api/mcp/[transport]` via `withMcpAuth`.
2. If token starts with `stp_mcp_` (API key path, `auth.ts:73`):
   - SHA-256 hash lookup in `api_keys` table (`auth.ts:146-152`)
   - Check expiration and revocation
   - Verify principal exists (`auth.ts:163-170`)
   - Update `last_used_at` (AWAITED, `auth.ts:175-178`)
   - Initial plan: "free" (`auth.ts:185`)
3. If token is anything else (OAuth path, `auth.ts:77-102`):
   - Clerk `auth()` with `acceptsToken: "oauth_token"`
   - Verify Clerk token
   - Extract userId and clientId
   - Initial plan: "free" (`auth.ts:93`)
4. **Subscription gate** (`auth.ts:109-128`): `checkActiveSubscription(candidate.principalId)`. If `!sub.isActive`, returns null (blocked). If active, maps Stripe price ID to tier via `priceIdToTier(sub.plan)` (`auth.ts:119`). This overwrites the initial "free" plan.
5. **Fail-closed on subscription error** (`auth.ts:120-128`): Any exception blocks access.

**Entitlement (src/lib/mcp/entitlement.ts):**

Tier gate: `ACTION_PLAN_GATE` maps action keys to minimum tier (`entitlement.ts:30-52`). `tierMeets` compares via index in `TIER_RANK = ["free", "starter", "creator", "pro"]` (`plans.ts:225, 284-286`).

Quota counter: `atomic_increment_quota` RPC (`entitlement.ts:173-178`). Parameters: `_principal_id text, _period text, _action text, _cap integer`. Returns new count on success, NULL on cap hit. **Quota gate fails open on RPC error** (`entitlement.ts:180-187`): returns `{ allowed: true }` on error. This is documented as intentional in the code.

**priceIdToTier (src/lib/types/plans.ts:267-279):** Built from both `devPlanPrices` and `prodPlanPrices` arrays at module load (`plans.ts:237`). 12 price IDs total (6 dev + 6 prod, monthly + yearly for Starter/Creator/Pro). Unknown IDs resolve to "free" with console.error.

Note: `price_1TBCLaCyG8V2WH2Ff8AhK1zC` exists in `devPriceIdAccountLimits` (`plans.ts:157`) but NOT in `devPlanPrices`, so it is NOT in the tier map and resolves to "free". Any user on this test plan is blocked from MCP.

### Inngest fan-out

**Dispatcher (scheduledPostsTick.ts):**

- Cron: `* * * * *` (every minute, `scheduledPostsTick.ts:20`)
- Query: `.eq("status", "scheduled")` ONLY, not "queued" (`scheduledPostsTickHelpers.ts:24`)
- Batch size: `RUNTIME.dispatcherBatchSize` = 200 default (`runtimeConfig.ts:19`)
- markPostsAsQueued guard: `.eq("status", "scheduled")` (idempotent, `scheduledPostsTickHelpers.ts:64-65`)
- Event id: `post.due-${post.id}-${post.scheduled_at}` (Inngest 24h dedup, `scheduledPostsTick.ts:43`)
- Concurrency: limit 1 (only one tick at a time, `scheduledPostsTick.ts:17`)

**Worker (processSinglePost.ts):**

- Retries: `Math.min(RUNTIME.maxRetries, 20) as 0|1|2|3|4|5` (default 3, `processSinglePost.ts:36`)
- Concurrency: `{ limit: RUNTIME.workerConcurrency }` = 5 default (`processSinglePost.ts:37`)
- Throttle: 5 per social_account_id per minute (`processSinglePost.ts:38-42`)
- Step "claim-post": CAS via `.in("status", ["scheduled", "queued"])` (`processSinglePostHelpers.ts:121-122`)

**Error classification (platformErrors.ts:34-59):**

| Pattern | Reason | Retryable |
|---------|--------|-----------|
| Pinterest "doesn't allow you to save pins" | policy_rejected | No |
| Pinterest "doesn't allow" | policy_rejected | No |
| "no content found" | invalid_input | No |
| "no board selected" | invalid_input | No |
| "no linkedin identifier" | invalid_input | No |
| "invalid token" / "expired" | auth_expired | Yes |
| "too many" / "rate limit" | rate_limited | Yes |
| "timeout" / "etimedout" | transient | Yes |
| "network" / "econnreset" | transient | Yes |
| "history" | invalid_input | No |
| empty / anything else | unknown | No |

**Runtime config (src/lib/jobs/runtimeConfig.ts):**

| Env var | Default | Line |
|---------|---------|------|
| `MAX_DURATION_S` | 300 | 10 |
| `WORKER_CONCURRENCY` | 5 | 11 |
| `PER_ACCOUNT_THROTTLE_PER_MIN` | 5 | 12 |
| `MAX_FILE_MB` | 100 | 16 |
| `POLL_WINDOW_S` | 120 | 17 |
| `WORKER_MAX_RETRIES` | 3 | 18 |
| `DISPATCHER_BATCH_SIZE` | 200 | 19 |
| `SIGNED_URL_TTL_S` | 300 | 20 |

No `process.env.*` reads in `src/inngest/` or `src/lib/jobs/` outside `runtimeConfig.ts`.

### Web UI scheduling

**Post-now flow:** SocialPostForm -> handleSocialMediaPost(isScheduled=false) -> fetch() to /api/social/{platform}/process -> process{Platform}Accounts -> fetch() to /api/social/{platform}/post -> directPostFor{Platform}Accounts.

Two HTTP hops (server -> /process -> /post). Neither carries cookies.

**Schedule flow:** SocialPostForm -> handleSocialMediaPost(isScheduled=true) -> fetch() to /api/social/{platform}/process -> process{Platform}Accounts(isScheduled=true) -> scheduleFor{Platform}Account -> schedulePost(data, userId).

The schedulePost public wrapper calls authCheck(userId) AGAIN, inside the cookieless /process route context. This is the source of the `Expected: "null"` production bug.

**No web-based bulk schedule.** Bulk scheduling is MCP-only (`bulkSchedule.ts`).

### Direct-post helpers (the convergence pinch point)

All four `directPostFor{Platform}Accounts` functions are called from exactly two contexts:

| Caller | Context | isCronJob | principal_id source |
|--------|---------|-----------|---------------------|
| `/api/social/{platform}/post/route.ts` | Web UI post-now (via handleSocialMediaPost chain) | false (from request body) | config.userId (from SocialPostForm) |
| `processSinglePostHelpers.ts` | Inngest worker (scheduled posts) | true (hardcoded) | post.principal_id (from DB row) |

When `isCronJob=true`:
- On failure: writes to `failed_posts` via `storeFailedPost`
- On success: writes to `content_history` via `storeContentHistory`

When `isCronJob=false`:
- On failure: returns error response only. No `failed_posts` row.
- On success: writes to `content_history` via `storeContentHistory`

### Storage and signed URLs

**Signed view URL flow:**
1. Caller invokes `getSignedViewUrl(path, userId, expiresIn)` (`src/actions/client/getSignedViewUrl.ts:9`)
2. This POSTs to `https://sharetopus.com/api/storage/generate-view-url` (hardcoded, `getSignedViewUrl.ts:16`)
3. The route (`src/app/api/storage/generate-view-url/route.ts:4`) has NO auth. It calls `adminSupabase.storage.from("scheduled-videos").createSignedUrl(path, expiresIn)` and returns the signed URL.
4. The `requestUserId` parameter sent by the client is never read by the route (`route.ts:6` only destructures `path` and `expiresIn`).

**TikTok proxy URL:**
`createSecureMediaUrlSigned(filePath, userId)` (`src/actions/server/data/mediaURL.ts:8-20`) generates `https://sharetopus.com/api/media?file={filePath}&user={userId}`. Despite the function name, there is no HMAC signing, no expiry, no token.

**Pinterest image posting:**
The Supabase signed URL is passed verbatim as `media_source.url` to `https://api.pinterest.com/v5/pins` (`postImage.ts:28-31`). Pinterest's servers fetch from the URL. The URL format is `https://{project}.supabase.co/storage/v1/object/sign/scheduled-videos/{path}?token={jwt}&...`.

**Pinterest video posting:**
No signed URL is used. `createVideoPin` downloads the file buffer via `getSupabaseVideoFile` (`createVideoPin.ts:54`), then uploads raw bytes to Pinterest's S3 endpoint via FormData.

**TTL values:**
- handleSocialMediaPost: 300s hardcoded (`handleSocialMediaPost.ts:315`)
- Inngest worker: `RUNTIME.signedUrlTtlS` = 300s default (`runtimeConfig.ts:20`, used at `processSinglePostHelpers.ts:195`)

### Subscriptions and plan tier

**checkActiveSubscription** (`src/actions/checkActiveSubscription.ts:7`):
- Queries `stripe_subscriptions WHERE user_id = userId AND status IN ('active', 'trialing')`, limit 1, newest first.
- Returns `{ isActive, plan }` where `plan` is the raw Stripe price ID.
- Fallback for no subscription: `isActive: false, plan: null`.

**checkUserSubscription** (`src/actions/server/stripe/checkUserSubscription.ts`):
- ALSO includes `'past_due'` as active. Only used by `customerPortal.ts`.
- Calls `authCheck(userId)` first (requires Clerk session).

**Stripe webhook handler** (`src/app/api/webhooks/stripe/route.ts`):
- Stores the raw plan price ID as `stripe_subscriptions.plan`.
- Returns HTTP 200 even when no matching user is found, silently dropping orphaned events.

**Price-id-to-tier mapping** (`src/lib/types/plans.ts:235-279`):
- Built from BOTH `devPlanPrices` and `prodPlanPrices` at module load.
- Maps 12 price IDs (Starter/Creator/Pro x Monthly/Yearly x Dev/Prod).
- Unknown IDs resolve to "free" with console.error.

## Auth-context audit

### Every authCheck callsite

| File:Line | Caller | Provided userId | Expected (Clerk auth()) | Auth context | Risk |
|-----------|--------|----------------|------------------------|-------------|------|
| `authCheck.ts:9` | (definition) | -- | -- | -- | -- |
| `handleSocialMediaPost.ts:149` | handleSocialMediaPost | config.userId (from SocialPostForm) | Clerk session (server action context) | Web UI direct | OK: server action has cookies |
| `schedulePost.ts:31` | schedulePost (public) | userId param | Clerk session | **Varies: web UI or /process route** | **BUG: null when called from /process** |
| `cancelScheduledPost.ts:36` | cancelScheduledPostBatch | userId param | Clerk session | Web UI BatchedPostCard | OK |
| `deleteScheduledPost.ts:41` | deleteScheduledPostBatch (else branch) | userId param | Clerk session | Web UI | OK |
| `getScheduledPosts.ts:23` | getScheduledPosts | userId param | Clerk session | Web UI PostsGrid | OK |
| `resumeScheduledPost.ts:37` | resumeScheduledPostBatch | userId param | Clerk session | Web UI | OK |
| `updateScheduledTime.ts:38` | updateScheduledTimeBatch | userId param | Clerk session | Web UI | OK |
| `fetchSocialAccounts.ts:26` | fetchSocialAccounts | userId param | Clerk session | Web UI | OK |
| `getContentHistory.ts:22` | getContentHistory | userId param | Clerk session | Web UI | OK |
| `deleteSupabaseFileAction.ts:42` | deleteSupabaseFileAction (else) | userId param | Clerk session | Web UI | OK |
| `disconnectSocialAccount.ts:30` | disconnectSocialAccount | userId param | Clerk session | Web UI | OK |
| `checkUserSubscription.ts:23` | checkUserSubscription | userId param | Clerk session | Web UI | OK |
| `customerPortal.ts:36` | createCustomerPortal | auth() locally | Clerk session (same call) | Web UI | OK |
| `checkOutSession.ts:48` | checkOutSession | auth() locally | Clerk session (same call) | Web UI | OK |
| `createApiKey.ts:37` | createApiKey | userId param | Clerk session | Web UI | OK |
| `listApiKeys.ts:30` | listApiKeys | userId param | Clerk session | Web UI | OK |
| `revokeApiKey.ts:21` | revokeApiKey | userId param | Clerk session | Web UI | OK |

### Known regression: authCheck Expected: "null"

**Production log:**
```
[authCheck] Authentication failed: User ID mismatch. Provided: "user_3DNnqFjYoyAJjjLdXcxSb8FhaFS", Expected: "null"
```

**Source:** `src/actions/server/authCheck.ts:22-25`

**Root cause trace:**

1. User clicks "Schedule" in `SocialPostForm.tsx:720`.
2. `handleSocialMediaPost` is called as a server action with `config.userId = "user_3DNnq..."` and `config.isScheduled = true`.
3. `handleSocialMediaPost.ts:149`: `authCheck(userId)` succeeds (Clerk session is present, cookies forwarded by Next.js server action runtime).
4. `handleSocialMediaPost.ts:374`: `fetch("${FRONTEND_URL}/api/social/pinterest/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({...userId...}) })`. **No Cookie header. No Authorization header.**
5. `/api/social/pinterest/process/route.ts` receives the request. No auth check at route level.
6. `processPinterestAccounts.ts:88`: `isScheduled=true` branch calls `scheduleForPinterestAccount(...)`.
7. `scheduleForPinterestAccounts.ts:77`: calls `schedulePost(scheduleData, userId)` where `userId = "user_3DNnq..."`.
8. `schedulePost.ts:31`: calls `authCheck(userId)`.
9. `authCheck.ts:11`: `const { userId: clerkAuth } = await auth()`. Since this is running in a plain API route handler reached via a `fetch()` without cookies, Clerk has no session. `clerkAuth = null`.
10. `authCheck.ts:22`: `"user_3DNnq..." !== null` is true. Logs `Expected: "null"`. Returns false.
11. `schedulePost.ts:33`: returns `{ success: false, message: "Authentication validation failed..." }`.

The bug is that `schedulePost` (the public wrapper) is called from within a cookieless API route context. The web schedule path goes through two server-to-self `fetch()` hops that strip cookies. The first hop (to `/process`) works because `/process` has no auth. But `/process` calls `scheduleForPinterestAccount`, which calls the public `schedulePost` wrapper, which calls `authCheck`.

The same bug affects all four platforms' schedule paths (LinkedIn, TikTok, Instagram all have the same `scheduleFor*Account -> schedulePost -> authCheck` chain when reached via `handleSocialMediaPost`).

This bug does NOT affect the MCP path (MCP tools call `schedulePostInternal` directly, skipping `authCheck`).

This bug does NOT affect the Inngest worker (which calls `directPostFor*Accounts` directly for already-scheduled posts, never calling `schedulePost`).

**Impact:** Every web-initiated "Schedule" action fails. Only web-initiated "Post Now" actions succeed (because they go through the /post route, which calls `directPostFor*Accounts` directly without any `schedulePost` call). This means NO new posts can be scheduled through the web UI. Only the MCP `schedule_post` and `bulk_schedule` tools work for scheduling.

## State of deprecated paths

### Old cron route /api/cron/process-scheduled-posts

**Status in code:** DELETED. The directory `src/app/api/cron/process-scheduled-posts/` does not exist. It was removed in commit 43014d8 (FIX 13).

**Remaining references in code:**
- `src/inngest/functions/scheduledPostsTick.ts:10-11` -- comment explaining it replaces this route
- `docs/` -- multiple documentation files reference it

**Risk:** If the Supabase Edge Function that called this route is still active, it will receive HTTP 404 responses. The Edge Function would log errors but scheduled posts would not double-process (the route handler code no longer exists). However, the Edge Function is wasting pg_cron invocations and generating noise in Supabase logs.

### Edge Function supabase/functions/process-scheduled-posts

**Status in code:** No `supabase/functions/` directory exists in the repo. The Edge Function source was never committed or has been removed.

**Operator must confirm:** Check Supabase Dashboard > Edge Functions. If an active `process-scheduled-posts` function exists, it is calling a deleted route and should be disabled.

### pg_cron job

**Status in code:** No `cron.schedule` calls found in any migration file.

**Operator must confirm** by running in Supabase SQL editor:
```sql
SELECT jobid, jobname, schedule, command, active, nodename
FROM cron.job
WHERE command ILIKE '%process-scheduled-posts%'
   OR command ILIKE '%/api/cron/%'
   OR command ILIKE '%edge%';
```

### Old routes /api/social/*/process and /api/social/*/post

**Status:** All 8 routes still exist and are actively used by `handleSocialMediaPost` for the web UI post-now flow. They are NOT deprecated per FIX 13 scope. FIX 13 notes: "A future PR can simplify handleSocialMediaPost to call directPostFor* in-process and then delete those four+four routes."

Callers:
- `/process` routes: called only by `handleSocialMediaPost.ts:349-441` via fetch()
- `/post` routes: called only by `process{Platform}Accounts.ts` via fetch()
- The Inngest worker does NOT call any of these routes.

## Race conditions and idempotency

### Scenario: pg_cron still active + Inngest worker running

If both pipelines read a due `scheduled_posts` row:

1. The Inngest dispatcher marks it `status='queued'` with `.eq("status", "scheduled")`.
2. The old cron path (if still active) calls `/api/cron/process-scheduled-posts`, which now returns 404 (route deleted). No row modification occurs.

**Outcome:** No double-processing. The old path fails silently (404). The Inngest path proceeds normally.

However, if the old cron path were hypothetically still working (route undeleted):
- The old path fetches by `batch_id`, not status. It does not check status before processing.
- The Inngest worker's claim step uses `.in("status", ["scheduled", "queued"])`.
- If the old path processes and DELETES the row (Option A behavior), the Inngest worker's fetch step returns skip:true (row not found). Safe.
- But the old path writes to `handleSocialMediaPost` which goes through the /process route chain, which would hit the authCheck bug. So it would fail before posting.

### Scenario: User clicks "Post Now" while a scheduled version is due

The "Post Now" path and the scheduled path operate on different rows. `handleSocialMediaPost` creates NO `scheduled_posts` row for direct posts. The scheduled version's row exists with its own ID. The Inngest worker processes the scheduled row independently.

If the user explicitly scheduled a post and then also posts the same content directly:
- Two independent content_history rows would be created (one from each path).
- Two posts would appear on the platform.
- No row-level conflict occurs in the database.

### Scenario: Inngest worker fails mid-step and retries

Each step is checkpointed. On retry:
- "fetch-post-and-account": idempotent read, no side effects.
- "claim-post": CAS guard `.in("status", ["scheduled", "queued"])` returns 0 rows if already claimed. Worker returns `skipped: true`.
- "build-signed-urls": pure computation/HTTP, no DB side effect.
- "call-platform-direct-post": NOT idempotent. If the directPostFor* function succeeds (posts to platform + writes content_history) but the step result is lost before checkpoint, the retry will post again and create a duplicate content_history row. The platform may also show a duplicate post. No dedup mechanism exists at this level.
- "record-status": CAS guard `.eq("status", "processing")` prevents double-update.
- "cleanup-storage": Reference-checked delete; idempotent.

**The "call-platform-direct-post" step is the non-idempotent pinch point.** A post to the platform API cannot be un-done. If Inngest's checkpoint write fails after the platform API call succeeds, the retry will create a duplicate post. The risk is low (requires a failure between platform API success and Inngest checkpoint persist) but non-zero.

## Config drift

### Env vars in code but NOT in .env.example

| Variable | Where used |
|----------|-----------|
| `MAX_DURATION_S` | `src/lib/jobs/runtimeConfig.ts:10` |
| `WORKER_CONCURRENCY` | `src/lib/jobs/runtimeConfig.ts:11` |
| `PER_ACCOUNT_THROTTLE_PER_MIN` | `src/lib/jobs/runtimeConfig.ts:12` |
| `MAX_FILE_MB` | `src/lib/jobs/runtimeConfig.ts:16` |
| `POLL_WINDOW_S` | `src/lib/jobs/runtimeConfig.ts:17` |
| `WORKER_MAX_RETRIES` | `src/lib/jobs/runtimeConfig.ts:18` |
| `DISPATCHER_BATCH_SIZE` | `src/lib/jobs/runtimeConfig.ts:19` |
| `SIGNED_URL_TTL_S` | `src/lib/jobs/runtimeConfig.ts:20` |
| `INNGEST_EVENT_KEY` | Inngest SDK (reads automatically, not via process.env in user code) |
| `INNGEST_SIGNING_KEY` | Inngest SDK (reads automatically) |
| `INNGEST_SIGNING_KEY_FALLBACK` | Inngest SDK (reads automatically) |

All 8 RUNTIME vars have defaults and are optional. The 3 INNGEST vars are required for Inngest to function but are managed by the Vercel-Inngest integration.

### Env vars in .env.example but NOT referenced via process.env in user code

| Variable | Notes |
|----------|-------|
| `CLERK_SECRET_KEY` | Used by @clerk/nextjs SDK internally |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Used by Clerk client SDK internally |
| `STRIPE_PUBLISHABLE_KEY` | Used by Stripe.js on client side |

These are consumed by SDKs, not by user code via `process.env`.

## Production log explanations

### "[authCheck] Authentication failed: User ID mismatch. Provided: 'user_3DNnq...' Expected: 'null'"

```
LOG: [authCheck] Authentication failed: User ID mismatch. Provided: "user_3DNnqFjYoyAJjjLdXcxSb8FhaFS", Expected: "null"
SOURCE: src/actions/server/authCheck.ts:22-25
TRIGGER: SocialPostForm.tsx:720 -> handleSocialMediaPost(isScheduled=true) ->
         fetch(/api/social/pinterest/process) [no cookies] ->
         processPinterestAccounts(isScheduled=true) ->
         scheduleForPinterestAccount ->
         schedulePost(data, userId) ->
         authCheck(userId)
ROOT CAUSE: The web schedule flow calls the public schedulePost wrapper from within
an API route context reached via an internal fetch() that does not forward cookies.
Clerk's auth() returns { userId: null } because there is no session. The provided
userId is a valid Clerk user ID passed through the JSON request body, but it does
not match null. Template literal interpolation of null produces the string "null".
Every web-initiated schedule action for every platform hits this bug.
```

### Pinterest "invalid URL" code 1

```
LOG: [Pinterest] Image pin creation failed: code 1, "Whoops! It looks like you entered an invalid URL"
SOURCE: src/lib/api/pinterest/post/postImage.ts:48-54 (the console.error + return block)
TRIGGER: Inngest processSinglePost -> callPlatformDirectPost -> directPostForPinterestAccounts ->
         postToPinterest -> createImagePin -> POST https://api.pinterest.com/v5/pins
         with media_source.url = <Supabase signed URL>
ROOT CAUSE: Cannot be determined from source alone. The code at postImage.ts:28-31
passes the Supabase signed URL verbatim as media_source.url. The URL format is
https://{project}.supabase.co/storage/v1/object/sign/scheduled-videos/{path}?token={jwt}.
Possible causes:
  (a) The signed URL expired before Pinterest's servers fetched it (300s TTL, and
      Pinterest's fetch may be delayed under load).
  (b) Supabase's CDN or WAF rejected Pinterest's server IP range.
  (c) URL encoding issues in the path component (spaces, special characters in filename).
  (d) The file does not exist in the bucket (path mismatch).
Operator should capture the exact URL from the next Inngest run output (available in
Inngest dashboard > Runs > step output for "call-platform-direct-post") and test it
with curl to determine if the URL itself is valid at fetch time.
```

### Inngest signature validation failed ("No x-inngest-signature provided")

```
LOG: Signature validation failed ... No x-inngest-signature provided
SOURCE: inngest SDK internals (serve handler validates x-inngest-signature header)
TRIGGER: Any HTTP request to /api/inngest that does not include the Inngest signature header.
ROOT CAUSE: The Inngest serve handler at src/app/api/inngest/route.ts:15-18 validates
incoming requests using INNGEST_SIGNING_KEY. If the env var is not set in the Vercel
deployment, or if a non-Inngest client (browser, curl, monitoring probe) hits the
endpoint, the signature check fails. This is expected behavior for unauthorized requests.
If this appears in production logs during normal Inngest operation, it means
INNGEST_SIGNING_KEY is not set or does not match the Inngest Cloud configuration.
Operator must confirm the env var is present in Vercel: Settings > Environment Variables.
```

### "[Pinterest Direct Post] Failed with error: Failed to create image pin"

```
LOG: [Pinterest Direct Post] Failed with error: Failed to create image pin
SOURCE: src/lib/api/pinterest/post/directPostForPinterestAccounts.ts:157-160
TRIGGER: Same as the "invalid URL" trace above. directPostForPinterestAccounts calls
         postToPinterest, which calls createImagePin, which returns
         { success: false, error: "Failed to create image pin", message: <Pinterest error> }.
         directPostForPinterestAccounts logs the error at line 157 and the message at line 160.
ROOT CAUSE: This is the wrapper log around the Pinterest API error. The actual API error
(code 1, "invalid URL") is in the preceding log line. See the Pinterest "invalid URL"
explanation above.
```

### "[handleSocialMediaPost]: Starting scheduled post process for 1 total accounts"

```
LOG: [handleSocialMediaPost]: Starting scheduled post process for 1 total accounts
SOURCE: src/components/core/create/action/handleSocialMediaPost/handleSocialMediaPost.ts:140-144
TRIGGER: SocialPostForm.tsx:720 calls handleSocialMediaPost with isScheduled=true.
         The log template is: "[handleSocialMediaPost]: Starting ${isScheduled ? 'scheduled' : 'direct'}
         post process for ${totalAccounts} total accounts"
ROOT CAUSE: This is a web UI schedule action, NOT a cron tick. The word "scheduled" in the
log refers to handleSocialMediaPost's isScheduled flag (user chose to schedule, not post now).
The Inngest worker does NOT call handleSocialMediaPost at all; it calls directPostFor*Accounts
directly. If this log appears in production, it confirms a user initiated a schedule action
via the web UI. The subsequent authCheck failure (Expected: "null") confirms the scheduling
attempt failed.
If the operator is seeing handleSocialMediaPost logs on what they expected to be Inngest
tick processing, the explanation is that the log is from a user action, not from Inngest.
The Inngest worker logs use "[processSinglePost]" and "[scheduledPostsTick]" prefixes instead.
```

## Observations

1. **CRITICAL: Eight API routes have zero authentication.** `/api/social/{platform}/process` and `/api/social/{platform}/post` for all four platforms accept arbitrary JSON from any client. An attacker with the server URL can trigger posts using any social account ID. The only barrier is that `ensureValidToken` fetches the token from the DB by account ID (not by userId), so the attacker would need to guess a valid account UUID. (`process/route.ts` and `post/route.ts` for each platform.)

2. **CRITICAL: `/api/storage/generate-view-url` has zero authentication.** Any client can POST `{ path: "any/path", expiresIn: 3600 }` and receive a signed Supabase Storage URL for any file in the `scheduled-videos` bucket. This is an information disclosure vulnerability. (`src/app/api/storage/generate-view-url/route.ts:4-6`.)

3. **HIGH: Web UI scheduling is broken.** The `authCheck Expected: "null"` bug blocks all web-initiated schedule actions for all four platforms. The bug is in the architecture: `handleSocialMediaPost` calls internal `/process` routes via `fetch()` without forwarding cookies, then the schedule path within those routes calls `schedulePost` which calls `authCheck`. Clerk has no session context. (Traced above in the Auth-context audit.)

4. **HIGH: `createSecureMediaUrlSigned` is misnamed.** It generates `https://sharetopus.com/api/media?file={path}&user={userId}` with NO cryptographic signature, no HMAC, no expiry. Any client that guesses or intercepts this URL can stream the file. (`src/actions/server/data/mediaURL.ts:8-20`.)

5. **MEDIUM: Inngest worker's "call-platform-direct-post" step is not idempotent.** If the platform API call succeeds but the Inngest checkpoint fails, the retry will create a duplicate post on the platform and a duplicate `content_history` row. (`processSinglePost.ts:106`.)

6. **MEDIUM: MCP quota gate fails open on RPC error.** If the `atomic_increment_quota` RPC fails (DB unavailable), the user is allowed through without quota tracking. (`entitlement.ts:180-187`.)

7. **MEDIUM: Audit redaction does not recurse into arrays.** `redactSecrets` in `audit.ts:96` walks objects but skips arrays. Secrets inside array elements would appear unredacted in `mcp_audit_log`. No current tool appears to have array-of-objects with secret fields, but this is latent. (`src/lib/mcp/audit.ts:87-103`.)

8. **MEDIUM: Dev test plan price ID not in tier map.** `price_1TBCLaCyG8V2WH2Ff8AhK1zC` from `devPriceIdAccountLimits` is NOT in `devPlanPrices`, so `priceIdToTier` resolves it to "free". Any user on this test subscription is blocked from MCP. (`src/lib/types/plans.ts:157` vs `plans.ts:237`.)

9. **MEDIUM: `getSignedViewUrl` is hardcoded to production URL.** The function at `src/actions/client/getSignedViewUrl.ts:16` always POSTs to `https://sharetopus.com/api/storage/generate-view-url`, even in development. Local dev and staging environments cannot mint their own signed URLs; they hit production. This also means the unauthenticated `/api/storage/generate-view-url` endpoint on production receives requests from all environments.

10. **MEDIUM: Stripe webhook handler silently drops events for unknown users.** When `customer.subscription.created` fires for a `stripe_customer_id` with no matching user row, the handler returns HTTP 200 (`src/app/api/webhooks/stripe/route.ts:73-77`). This prevents Stripe retries but means the subscription is never recorded. If the user row is created later (delayed webhook), the subscription event is lost.

11. **LOW: MCP resources have entitlement checks despite comment saying otherwise.** `src/lib/mcp/resources/index.ts:12` says "resources are not gated by entitlement checks." The actual implementations at `connections.ts:27`, `scheduledPosts.ts:27`, `contentHistory.ts:27` all call `entitlementFor()`.

12. **LOW: LinkedIn `directPostForLinkedInAccounts` has a dead `cronSecret` parameter.** It is in the interface (`DirectPostConfig`, line 33) but never referenced in the function body.

13. **LOW: MCP resources do not audit-log.** Unlike tools, none of the 3 resource handlers call `logToolCall()`. Resource reads are invisible to the audit trail.

14. **LOW: handleSocialMediaPost has a 30-second sleep.** When TikTok or Instagram accounts are involved in a direct post, the function waits 30 seconds before media cleanup (`handleSocialMediaPost.ts:499`). This blocks the server action and the user's browser for 30 seconds.

15. **LOW: `handleSocialMediaPost` passes `cronSecret` in JSON bodies to /process routes.** None of the /process routes read or validate it. The secret is exposed in network payloads for no purpose. (`handleSocialMediaPost.ts:367, 392, 417, 439`.)

## Open questions

1. **Is the Supabase pg_cron job still active?** Operator must run in Supabase SQL editor:
   ```sql
   SELECT jobid, jobname, schedule, command, active, nodename
   FROM cron.job
   WHERE command ILIKE '%process-scheduled-posts%'
      OR command ILIKE '%/api/cron/%'
      OR command ILIKE '%edge%';
   ```

2. **Is the Supabase Edge Function still deployed and active?** Operator must check: Supabase Dashboard > Edge Functions. Look for `process-scheduled-posts`. If active, disable it.

3. **Are INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY, and INNGEST_SIGNING_KEY_FALLBACK set in Vercel?** These are not referenced via `process.env` in user code (the SDK reads them automatically). Operator must check: Vercel > Settings > Environment Variables.

4. **Is Inngest receiving the cron ticks?** Operator must check: Inngest Dashboard > Apps > sharetopus > Functions > scheduled-posts-tick. Should show runs every minute.

5. **What is the exact Supabase signed URL that Pinterest rejected?** Next time a Pinterest "invalid URL" error occurs, operator should:
   - Go to Inngest Dashboard > Runs > find the failed process-single-post run
   - Expand the "build-signed-urls" step output to see the URL
   - Test the URL with `curl -I <url>` within 300s to verify it resolves
   - If it 403s or 404s, the issue is Supabase-side (CDN, WAF, or bucket permissions)
   - If it 200s, the issue is Pinterest-side (URL format, encoding, or referrer restrictions)

6. **Has CRON_SECRET_KEY been rotated?** FIX 13 report notes the old value was leaked in the Edge Function source. Operator must confirm rotation in Vercel env vars.

7. **Are any of the 8 RUNTIME env vars set in Vercel?** All have defaults but operator may have customized them. Check Vercel > Settings > Environment Variables for `MAX_DURATION_S`, `WORKER_CONCURRENCY`, etc.

8. **Is there a Vercel middleware that restricts access to /api/social/* routes?** The `src/middleware.ts` file was not read in this audit. If middleware blocks external access to these routes, observation #1 is mitigated. Operator should check middleware config.
   ```bash
   grep -n "social" src/middleware.ts
   ```

## Files read for this audit

```
src/actions/checkActiveSubscription.ts
src/actions/client/getSignedViewUrl.ts
src/actions/server/_internal/data/deleteSupabaseFileAction.ts
src/actions/server/_internal/scheduleActions/cancelScheduledPostBatch.ts
src/actions/server/_internal/scheduleActions/deleteScheduledPostBatch.ts
src/actions/server/_internal/scheduleActions/getScheduledPosts.ts
src/actions/server/_internal/scheduleActions/resumeScheduledPostBatch.ts
src/actions/server/_internal/scheduleActions/schedulePost.ts
src/actions/server/_internal/scheduleActions/updateScheduledTimeBatch.ts
src/actions/server/authCheck.ts
src/actions/server/authCheckCronJob.ts
src/actions/server/contentHistoryActions/getContentHistory.ts
src/actions/server/contentHistoryActions/storeContentHistory.ts
src/actions/server/contentHistoryActions/storeFailedPost.ts
src/actions/server/data/deleteSupabaseFileAction.ts
src/actions/server/data/fetchSocialAccounts.ts
src/actions/server/data/mediaURL.ts
src/actions/server/mcp/createApiKey.ts
src/actions/server/mcp/listApiKeys.ts
src/actions/server/mcp/revokeApiKey.ts
src/actions/server/rateLimit/checkRateLimit.ts
src/actions/server/scheduleActions/cancelScheduledPost.ts
src/actions/server/scheduleActions/deleteScheduledPost.ts
src/actions/server/scheduleActions/getScheduledPosts.ts
src/actions/server/scheduleActions/resumeScheduledPost.ts
src/actions/server/scheduleActions/schedulePost.ts
src/actions/server/scheduleActions/updateScheduledTime.ts
src/actions/server/stripe/checkOutSession.ts
src/actions/server/stripe/checkUserSubscription.ts
src/actions/server/stripe/customerPortal.ts
src/app/api/inngest/route.ts
src/app/api/mcp/[transport]/route.ts
src/app/api/social/instagram/post/route.ts
src/app/api/social/instagram/process/route.ts
src/app/api/social/linkedin/post/route.ts
src/app/api/social/linkedin/process/route.ts
src/app/api/social/pinterest/post/route.ts
src/app/api/social/pinterest/process/route.ts
src/app/api/social/tiktok/post/route.ts
src/app/api/social/tiktok/process/route.ts
src/app/api/storage/generate-upload-url/route.ts
src/app/api/storage/generate-view-url/route.ts
src/app/api/webhooks/clerk/route.ts
src/app/api/webhooks/stripe/route.ts
src/components/core/create/SocialPostForm.tsx
src/components/core/create/action/handleSocialMediaPost/handleSocialMediaPost.ts
src/inngest/client.ts
src/inngest/functions/platformErrors.ts
src/inngest/functions/processSinglePost.ts
src/inngest/functions/processSinglePostHelpers.ts
src/inngest/functions/scheduledPostsTick.ts
src/inngest/functions/scheduledPostsTickHelpers.ts
src/lib/api/instagram/post/directPostForInstagramAccounts.ts
src/lib/api/instagram/post/postToInstagram.ts
src/lib/api/instagram/processAccounts/processInstagramAccounts.ts
src/lib/api/linkedin/post/directPostForLinkedInAccounts.ts
src/lib/api/linkedin/post/postToLinkedIn.ts
src/lib/api/linkedin/processAccounts/processLinkedinAccounts.ts
src/lib/api/pinterest/post/createVideoPin.ts
src/lib/api/pinterest/post/directPostForPinterestAccounts.ts
src/lib/api/pinterest/post/postImage.ts
src/lib/api/pinterest/post/postToPinterest.ts
src/lib/api/pinterest/processAccounts/processPinterestAccounts.ts
src/lib/api/pinterest/schedule/scheduleForPinterestAccounts.ts
src/lib/api/tiktok/post/directPostForTikTokAccounts.ts
src/lib/api/tiktok/post/postToTikTok.ts
src/lib/api/tiktok/processAccounts/processTiktokAccounts.ts
src/lib/jobs/runtimeConfig.ts
src/lib/mcp/audit.ts
src/lib/mcp/auth.ts
src/lib/mcp/context.ts
src/lib/mcp/entitlement.ts
src/lib/mcp/prompts/auditCalendar.ts
src/lib/mcp/prompts/index.ts
src/lib/mcp/prompts/planWeekForPlatform.ts
src/lib/mcp/prompts/repurposePost.ts
src/lib/mcp/resources/connections.ts
src/lib/mcp/resources/contentHistory.ts
src/lib/mcp/resources/index.ts
src/lib/mcp/resources/scheduledPosts.ts
src/lib/mcp/tokens.ts
src/lib/mcp/tools/attachMediaFromUrl.ts
src/lib/mcp/tools/bulkSchedule.ts
src/lib/mcp/tools/cancelScheduledPosts.ts
src/lib/mcp/tools/deleteScheduledPosts.ts
src/lib/mcp/tools/generatePostDraft.ts
src/lib/mcp/tools/getAccountAnalytics.ts
src/lib/mcp/tools/index.ts
src/lib/mcp/tools/listBillingSummary.ts
src/lib/mcp/tools/listConnections.ts
src/lib/mcp/tools/listContentHistory.ts
src/lib/mcp/tools/listScheduledPosts.ts
src/lib/mcp/tools/requestAccountReauthLink.ts
src/lib/mcp/tools/reschedulePosts.ts
src/lib/mcp/tools/resumeScheduledPosts.ts
src/lib/mcp/tools/schedulePost.ts
src/lib/types/database.types.ts
src/lib/types/dbTypes.ts
src/lib/types/plans.ts
supabase/migrations/20260506000001_initial_schema.sql
supabase/migrations/20260507000001_atomic_increment_quota.sql
supabase/migrations/20260508000001_add_queued_status_to_scheduled_posts.sql
.env.example
package.json
tsconfig.json
vercel.json
change/REPORT.md
```

## Greps run

```
grep -rn "process-scheduled-posts|process-batch" src supabase --include="*.ts" --include="*.sql" -- 2 hits (inngest comment, docs)
grep -rn "handleSocialMediaPost" src --include="*.ts" -- 37 hits (definition, logs, type imports, 1 invocation at SocialPostForm.tsx:720)
grep -rn "directPostFor" src --include="*.ts" -- 8 definition/import pairs across 4 platforms
grep -rn "authCheck\b" src --include="*.ts" --include="*.tsx" -- 18 hits (1 definition + 17 callsites)
grep -rn "authCheckCronJob" src --include="*.ts" --include="*.tsx" -- 4 hits (1 definition + 3 callsites)
grep -rn "inngest.createFunction|cron:" src/inngest --include="*.ts" -- 2 functions found
grep -rn "cron.schedule|pg_cron" supabase/migrations/ -- 0 hits
grep -rn "process\.env\." src/inngest src/lib/jobs --include="*.ts" -- 0 hits outside runtimeConfig.ts
grep -rn "checkActiveSubscription|checkUserSubscription" src --include="*.ts" -- 10 hits
grep -rn "storeContentHistory|storeFailedPost" src --include="*.ts" -- 12 hits (2 definitions + 10 callsites)
grep -rn "Schedule For Pinterest Account|scheduleForPinterestAccount" src --include="*.ts" -- 5 hits
grep -rn "createImagePin|createVideoPin|postToPinterest" src --include="*.ts" -- 8 hits
grep -rn "INNGEST" src --include="*.ts" -- 0 hits (SDK reads env vars internally)
grep -rn "CRON_SECRET" src --include="*.ts" -- 6 hits
```
