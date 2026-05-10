# RECON: Inngest worker registration + code tree + duplicate audit

Date: 2026-05-09
Branch: main
HEAD: 2d15619 fix(tiktok): cover timestamp robust handling (FIX 17.2)
Working tree: clean (no uncommitted changes)

---

## Part 1: Inngest worker registration investigation

### Bug summary

The worker `tikTokPublishStatusPollWorker` (added in FIX 17.1, commit `4b397ce`) is **correctly defined and registered** in the Inngest serve endpoint. The function definition at `src/inngest/functions/tikTokPublishStatusPoll.ts:31-38` uses the same `createFunction` pattern as the two working functions. It IS included in the `functions` array at `src/app/api/inngest/route.ts:18`. The most likely root cause is that the dispatch uses `inngest.send()` (a direct HTTP call to the Inngest event API) instead of `step.sendEvent()` (a step-level primitive managed by Inngest's execution engine), and/or Inngest Cloud has not re-synced since the FIX 17.1 deploy.

### Curl evidence

```
$ curl -s -o /dev/null -w "%{http_code}" https://sharetopus.com/api/inngest
401

$ curl -s https://sharetopus.com/api/inngest
{"message":"Unauthorized"}
```

The Inngest serve endpoint is **live and responding** (HTTP 401). The 401 is expected -- Inngest SDK v4 requires a signing key for introspection (GET). This confirms the Vercel deployment is running code that includes the serve handler. However, we **cannot verify** from an unauthenticated curl whether the `tiktok-publish-status-poll` function is actually registered in the response body.

To verify: the operator must check the **Inngest Dashboard > Apps > sharetopus** function list.

### Working vs broken function comparison

| Field | `scheduledPostsTick` | `processSinglePost` | `tikTokPublishStatusPollWorker` |
|---|---|---|---|
| **File** | `src/inngest/functions/scheduledPostsTick.ts:14` | `src/inngest/functions/processSinglePost.ts:32` | `src/inngest/functions/tikTokPublishStatusPoll.ts:31` |
| **`id`** | `"scheduled-posts-tick"` | `"process-single-post"` | `"tiktok-publish-status-poll"` |
| **`name`** | `"Scheduled posts dispatcher"` | `"Post a single scheduled item"` | `"TikTok publish status poll"` |
| **Trigger shape** | `triggers: [{ cron: "* * * * *" }]` | `triggers: [{ event: "post.due" }]` | `triggers: [{ event: "tiktok.publish.poll" }]` |
| **concurrency** | `{ limit: 1 }` | `{ limit: RUNTIME.workerConcurrency }` | `{ limit: 50, key: "event.data.social_account_id" }` |
| **retries** | `0` | `Math.min(RUNTIME.maxRetries, 20)` | `0` |
| **throttle** | none | `{ limit, period: "1m", key: "event.data.social_account_id" }` | none |
| **Export name** | `scheduledPostsTick` | `processSinglePost` | `tikTokPublishStatusPollWorker` |
| **In `serve()` array** | YES (`route.ts:18`) | YES (`route.ts:18`) | YES (`route.ts:18`) |
| **Uses `step.run`** | YES | YES | YES |
| **Uses `step.sleep`** | NO | NO | YES (dynamic IDs in loop) |
| **Uses `step.sendEvent`** | YES (`scheduledPostsTick.ts:53`) | NO | NO |
| **Config object shape** | Single arg + `triggers` (v4) | Single arg + `triggers` (v4) | Single arg + `triggers` (v4) |

**Structural conclusion:** All three functions use the **identical Inngest v4 `createFunction` pattern**. There is no shape mismatch. The only structural differences are expected: different IDs, triggers, and concurrency configs.

### How the dispatch works

The event `tiktok.publish.poll` is dispatched by:

1. `processSinglePost` runs `step.run("call-platform-direct-post", ...)` (`processSinglePost.ts:106-115`)
2. Inside that step, `callPlatformDirectPost()` calls `directPostForTikTokAccounts()` (`processSinglePostHelpers.ts:271+`)
3. After a successful TikTok post, `directPostForTikTokAccounts` calls `dispatchTikTokPublishPollEvent()` (`directPostForTikTokAccounts.ts:169`)
4. `dispatchTikTokPublishPollEvent()` calls **`inngest.send()`** (`tikTokPublishStatusPollHelpers.ts:149`)

**Critical difference:** The working dispatch in `scheduledPostsTick` uses **`step.sendEvent("dispatch-due-posts", events)`** (`scheduledPostsTick.ts:53`). This is a step-level primitive -- Inngest manages the event dispatch as part of its execution engine, with automatic retries and tracking.

The TikTok poll dispatch uses **`inngest.send({ name: "tiktok.publish.poll", ... })`** (`tikTokPublishStatusPollHelpers.ts:149`). This is a **direct HTTP POST** to the Inngest event ingestion API. It requires `INNGEST_EVENT_KEY` to be set. If this HTTP call fails (network timeout within Vercel's function runtime, missing env var, rate limit), the error is caught and logged (`tikTokPublishStatusPollHelpers.ts:162-168`) but **never propagated** -- the function returns `{ success: false, message }` and the caller logs it but continues (`directPostForTikTokAccounts.ts:174-178`).

Furthermore, this `inngest.send()` call happens **inside** `step.run("call-platform-direct-post")`. Inngest's step execution context may affect direct HTTP calls made within step callbacks, particularly with checkpointing enabled.

### Inngest client configuration

**`src/inngest/client.ts:9-12`:**
```typescript
export const inngest = new Inngest({
  id: "sharetopus",
  maxRuntime: RUNTIME.maxDurationS * 1000,
});
```

No `eventKey` is explicitly passed. The Inngest SDK reads `INNGEST_EVENT_KEY` from the environment for `inngest.send()` calls.

**Required environment variables (per SDK docs + code):**
- `INNGEST_EVENT_KEY` -- required for `inngest.send()` (the dispatch method used)
- `INNGEST_SIGNING_KEY` -- required for `serve()` endpoint authentication
- No other Inngest-specific env vars referenced in the codebase

### Candidate root causes

#### 1. Dispatch uses `inngest.send()` instead of `step.sendEvent()` -- HIGHEST PROBABILITY

**Evidence FOR:**
- The working dispatch (`scheduledPostsTick.ts:53`) uses `step.sendEvent()`, which is managed by Inngest's execution engine
- The broken dispatch (`tikTokPublishStatusPollHelpers.ts:149`) uses `inngest.send()`, which makes a direct HTTP POST
- `inngest.send()` requires `INNGEST_EVENT_KEY` to authenticate with the event API. If this env var is missing or incorrect in the Vercel production environment, the call fails silently (error is caught, logged, never propagated)
- The dispatch happens deep inside `step.run("call-platform-direct-post")` -- Inngest v4 with checkpointing replays step callbacks; `inngest.send()` is a side effect that may behave unexpectedly during replay
- Error handling at `directPostForTikTokAccounts.ts:174-178` logs the failure but does not throw or halt the flow

**Evidence AGAINST:**
- `inngest.send()` is a documented, supported API. It should work if the event key is correct
- The same `inngest` client instance works for `serve()` authentication, so the client itself is correctly configured

**Verification step:** Check Vercel production logs for `[dispatchTikTokPublishPollEvent] Dispatch failed:` messages. If present, this is the cause.

#### 2. Inngest Cloud not re-synced after FIX 17.1 deploy -- MEDIUM PROBABILITY

**Evidence FOR:**
- The prior RECON_CODEBASE_AUDIT.md (at HEAD `4661199`, FIX 16) mentions "2 functions found" in the Inngest introspection response
- `tikTokPublishStatusPollWorker` was added in FIX 17.1 (commit `4b397ce`), 2 commits after the prior recon
- Per Inngest docs (https://www.inngest.com/docs/deploy/vercel), the Vercel integration auto-syncs on deploy. But if the integration is not installed, or if there is a version mismatch, manual sync via the Inngest dashboard is required
- The curl returns 401 (correct for production), but we cannot verify whether the function list includes 2 or 3 functions

**Evidence AGAINST:**
- If the Vercel-Inngest integration is properly configured, syncing happens automatically on every deploy
- The serve endpoint is live, suggesting the deploy succeeded

**Verification step:** Open Inngest Dashboard > Apps > sharetopus. Check if `tiktok-publish-status-poll` appears in the function list. If only 2 functions appear, click "Sync app" or redeploy.

#### 3. Vercel production has not deployed the FIX 17.1 commit -- LOW PROBABILITY

**Evidence FOR:**
- If Vercel auto-deploy failed or wasn't triggered, the production build is from FIX 16 or earlier, which doesn't include the new worker

**Evidence AGAINST:**
- `git log` shows FIX 17.2 is HEAD on main, and 3 commits have landed since FIX 16
- The curl to the Inngest endpoint returned a response (the endpoint is live), but this only proves the serve handler exists, not that the latest code is deployed

**Verification step:** Check Vercel dashboard for the latest production deployment commit hash. It should be `2d15619` or later.

#### 4. `INNGEST_EVENT_KEY` not set in Vercel production -- MEDIUM-LOW PROBABILITY

**Evidence FOR:**
- `inngest.send()` requires this env var. The Inngest client constructor (`client.ts:9`) does not pass an `eventKey` option, so the SDK falls back to the environment variable
- If `INNGEST_EVENT_KEY` is set in `.env.local` (dev) but not in Vercel's environment settings, the send would fail silently

**Evidence AGAINST:**
- If the `INNGEST_SIGNING_KEY` is set (which it must be for the serve endpoint to respond with 401 instead of 500), the operator likely also set `INNGEST_EVENT_KEY`. But this is not guaranteed -- they are separate keys.

**Verification step:** In Vercel dashboard, check Environment Variables for production. Confirm `INNGEST_EVENT_KEY` exists and is correct.

#### 5. Function ID collision -- RULED OUT

All three function IDs are unique (`scheduled-posts-tick`, `process-single-post`, `tiktok-publish-status-poll`). No collision. (`route.ts:18`)

#### 6. Trigger shape mismatch -- RULED OUT

All three functions use the identical `triggers: [{ event: "..." }]` array shape, which is the correct Inngest v4 SDK format. (`tikTokPublishStatusPoll.ts:37`, `processSinglePost.ts:40`, `scheduledPostsTick.ts:20`)

#### 7. Conditional registration -- RULED OUT

No conditional logic in `route.ts`. All 3 functions are unconditionally included. (`route.ts:16-18`)

#### 8. Import-time crash -- UNLIKELY

All imports in `tikTokPublishStatusPoll.ts` are standard server-side modules identical to those used by the working functions. `"server-only"` is used in the helpers file, same as the working helpers. No obvious import-time error. (`tikTokPublishStatusPoll.ts:1-12`)

### Most likely root cause

**The dispatch mechanism is the primary suspect.** The `dispatchTikTokPublishPollEvent` function at `src/inngest/functions/tikTokPublishStatusPollHelpers.ts:141-170` uses `inngest.send()` (line 149), a direct HTTP POST to the Inngest event API, instead of `step.sendEvent()`, which is the step-level primitive used by the working `scheduledPostsTick` function (line 53). This HTTP call:

1. Requires `INNGEST_EVENT_KEY` in the environment (unverifiable from code alone)
2. Happens inside a `step.run()` callback, where Inngest's checkpointing may replay the step and the HTTP call might behave unexpectedly
3. Has fire-and-forget error handling: failures are caught and logged but never propagated upward

**Secondary suspect:** Inngest Cloud may not have re-synced since FIX 17.1 deploy, meaning the function exists in code but Inngest Cloud doesn't know to route `tiktok.publish.poll` events to it.

Both issues could be active simultaneously: the event never reaches Inngest (cause 1), AND even if it did, Inngest doesn't know to route it (cause 2).

### Fix options

#### Option A: Refactor dispatch to use `step.sendEvent()` in `processSinglePost.ts`

**Scope:** Modify `processSinglePost.ts` to add a new step after `call-platform-direct-post` that dispatches the poll event using `step.sendEvent()`. Remove the `inngest.send()` call from `dispatchTikTokPublishPollEvent`. The dispatch becomes a step-level operation managed by Inngest.

**Files affected:**
- `src/inngest/functions/processSinglePost.ts` -- add conditional `step.sendEvent` after `call-platform-direct-post`
- `src/inngest/functions/processSinglePostHelpers.ts` -- return `publish_id` from `callPlatformDirectPost` result
- `src/lib/api/tiktok/post/directPostForTikTokAccounts.ts` -- return `publishId` in the result object; remove `dispatchTikTokPublishPollEvent` call
- `src/inngest/functions/tikTokPublishStatusPollHelpers.ts` -- `dispatchTikTokPublishPollEvent` may be deleted or kept for manual triggers

**Risk:** MEDIUM. Changes the `step.run` return type for the TikTok case. Must ensure `callPlatformDirectPost` returns enough data for the dispatch.

**Side effects:** Positive -- the dispatch becomes reliable, tracked, and visible in the Inngest dashboard. No separate `INNGEST_EVENT_KEY` dependency.

#### Option B: Keep `inngest.send()` but propagate errors and verify env var

**Scope:** Verify `INNGEST_EVENT_KEY` is set in Vercel. Modify `dispatchTikTokPublishPollEvent` to throw on failure instead of returning `{ success: false }`. Modify the caller to handle the throw.

**Files affected:**
- `src/inngest/functions/tikTokPublishStatusPollHelpers.ts` -- throw on failure
- `src/lib/api/tiktok/post/directPostForTikTokAccounts.ts` -- handle the throw

**Risk:** LOW. Smaller change, but leaves the architectural weakness (HTTP call inside step.run) in place.

**Side effects:** Errors become visible but the root cause (HTTP call vs step primitive) isn't fixed.

#### Option C: Force Inngest re-sync (dashboard or redeploy)

**Scope:** No code change. Trigger a sync in the Inngest Dashboard or redeploy on Vercel.

**Files affected:** None.

**Risk:** ZERO. But this only fixes cause 2 (stale function list). If cause 1 (dispatch failure) is also active, the worker still won't fire.

### Recommended next step

**Do Option C first** (zero-risk, 30 seconds) to rule out cause 2. Then check Vercel production logs for `[dispatchTikTokPublishPollEvent] Dispatch failed:` messages. If those messages appear, do Option A. If the dispatch succeeds but the worker still doesn't run, check `INNGEST_EVENT_KEY` in Vercel env vars. Option A is the long-term correct fix regardless, because `step.sendEvent()` is the reliable primitive.

### Open questions

1. **Is `INNGEST_EVENT_KEY` set in Vercel production?** Cannot verify from code. Must check Vercel dashboard.
2. **Does Inngest Dashboard show 2 or 3 functions for the sharetopus app?** The curl returns 401 (cannot introspect without signing key). Must check dashboard.
3. **Are there Vercel production logs showing `Dispatch failed` messages?** Cannot access from local. Must check Vercel logs.
4. **Has the Vercel-Inngest integration (auto-sync) been installed?** If using manual sync, a dashboard click is required after each deploy.
5. **Does `inngest.send()` behave correctly inside `step.run()` with checkpointing enabled?** Inngest docs do not explicitly address this scenario. Per https://www.inngest.com/docs/features/inngest-functions/steps-workflows/step-send-event, `step.sendEvent()` is the recommended way to send events from within functions.

---

## Part 2: Full code tree structure

### Top-level overview

| Category | Count |
|---|---|
| Total .ts/.tsx source files under `src/` | 286 |
| Route handlers (`route.ts`) | 24 |
| Server actions (`"use server"`) | 22 |
| Pages + layouts (`page.tsx` / `layout.tsx`) | 19 |
| Inngest functions (`inngest.createFunction`) | 3 |
| MCP tools (`server.tool`) | 14 |
| MCP resources | 3 |
| MCP prompts | 3 |
| shadcn/ui primitives | 33 |
| Platform API modules (4 platforms) | ~33 |
| Internal (`_internal`) actions | 8 |
| Candidate orphan files | 8 |

### Top-level config files

```
package.json                 -- Next.js 16.1.6, React 19.2, Clerk 7, Supabase, Stripe 18, Inngest 4.3, MCP SDK 1.29, shadcn/ui + Radix, Tailwind 4, Upstash Redis/QStash
tsconfig.json                -- strict: true, ES2017 target, bundler resolution, path alias @/* -> ./src/*, incremental
next.config.ts               -- serverActions.bodySizeLimit: "5mb", 5 remote image hostname patterns
eslint.config.mjs            -- flat config extending next/core-web-vitals + next/typescript
vercel.json                  -- maxDuration: 60 for src/app/api/direct/**/*.ts
components.json              -- shadcn/ui: new-york style, RSC, CSS variables, lucide icons
postcss.config.mjs           -- Tailwind CSS v4 PostCSS plugin
i18n-config.ts               -- locales: fr (default), en, es (NOT imported anywhere in src/)
next-sitemap.config.js       -- siteUrl: https://sharetopus.com
.env.example                 -- environment variable template
```

### Annotated tree

#### src/app/ -- Next.js App Router (48 files)

##### Layouts and global files
```
src/app/layout.tsx                                     -- Root layout: ClerkProvider, Toaster, Vercel Analytics/SpeedInsights, SEO metadata
src/app/globals.css                                    -- Global Tailwind CSS styles
src/app/robots.ts                                      -- Robots.txt: allow /, disallow /api/ and /admin/
src/app/not-found.tsx                                  -- Custom 404 page with marketing navbar/footer
src/app/(protected)/layout.tsx                         -- Protected area layout: ensureUserExists(), AppSidebar + SiteHeader
```

##### Marketing pages (unauthenticated)
```
src/app/(marketing)/page.tsx                           -- Landing page: Hero, Testimonials, Stats, Features, Pricing, Footer
src/app/(marketing)/PrivacyPolicy/page.tsx             -- Privacy policy page
src/app/(marketing)/tos/page.tsx                       -- Terms of service page
```

##### Protected pages (authenticated)
```
src/app/(protected)/connections/page.tsx                -- Social account connection management with limit checking
src/app/(protected)/create/page.tsx                     -- Post type selector (Text/Image/Video) with subscription gate
src/app/(protected)/create/text/page.tsx                -- Text post creation form
src/app/(protected)/create/image/page.tsx               -- Image post creation form with upload limits per plan
src/app/(protected)/create/video/page.tsx               -- Video post creation form with upload limits per plan
src/app/(protected)/scheduled/page.tsx                  -- Scheduled posts grid with Suspense skeleton
src/app/(protected)/scheduled/error.tsx                 -- Error boundary for scheduled posts page
src/app/(protected)/posted/page.tsx                     -- Content history (posted items) with Suspense skeleton
src/app/(protected)/studio/page.tsx                     -- Studio page placeholder (ComingSoon component)
src/app/(protected)/payment/success/page.tsx            -- Stripe payment success page with confetti animation
src/app/(protected)/userProfile/[[...rest]]/page.tsx    -- Clerk user profile catch-all route
src/app/(protected)/integrations/page.tsx               -- MCP API key management and docs (subscription-gated)
src/app/(protected)/integrations/components/ApiKeysCard.tsx    -- Client component for creating/revoking MCP API keys
src/app/(protected)/integrations/components/McpDocsCard.tsx     -- Documentation card for MCP integration instructions
```

##### API route handlers
```
src/app/api/inngest/route.ts                           -- Inngest serve endpoint (GET/POST/PUT), maxDuration=300, registers 3 functions
src/app/api/mcp/[transport]/route.ts                   -- MCP Streamable HTTP + SSE endpoint, resolves Bearer to McpPrincipal
src/app/.well-known/oauth-protected-resource/route.ts  -- RFC 9728 OAuth protected resource metadata for Clerk MCP auth
src/app/api/auth/[clerk]/page.tsx                      -- Clerk SignIn page component
src/app/api/media/route.ts                             -- Media proxy: streams files from Supabase to TikTok with path validation
src/app/api/storage/generate-upload-url/route.ts       -- Generates Supabase signed upload URLs with storage quota enforcement
src/app/api/storage/generate-view-url/route.ts         -- Generates Supabase signed view URLs for media preview
src/app/api/webhooks/clerk/route.ts                    -- Clerk webhook: user.created/updated/deleted sync to Supabase + Stripe
src/app/api/webhooks/stripe/route.ts                   -- Stripe webhook: subscription/invoice events sync to Supabase
src/app/api/social/instagram/initiate/route.ts         -- Instagram OAuth initiation with account limit check
src/app/api/social/instagram/connect/route.ts          -- Instagram OAuth callback: exchanges code, stores token + profile
src/app/api/social/instagram/post/route.ts             -- Instagram direct post endpoint (cron-authenticated)
src/app/api/social/instagram/process/route.ts          -- Instagram batch process endpoint (cron-authenticated)
src/app/api/social/linkedin/initiate/route.ts          -- LinkedIn OAuth initiation
src/app/api/social/linkedin/connect/route.ts           -- LinkedIn OAuth callback
src/app/api/social/linkedin/post/route.ts              -- LinkedIn direct post endpoint
src/app/api/social/linkedin/process/route.ts           -- LinkedIn batch process endpoint
src/app/api/social/pinterest/initiate/route.ts         -- Pinterest OAuth initiation
src/app/api/social/pinterest/connect/route.ts          -- Pinterest OAuth callback
src/app/api/social/pinterest/post/route.ts             -- Pinterest direct post endpoint
src/app/api/social/pinterest/process/route.ts          -- Pinterest batch process endpoint
src/app/api/social/tiktok/initiate/route.ts            -- TikTok OAuth initiation
src/app/api/social/tiktok/connect/route.ts             -- TikTok OAuth callback
src/app/api/social/tiktok/post/route.ts                -- TikTok direct post endpoint
src/app/api/social/tiktok/process/route.ts             -- TikTok batch process endpoint
```

#### src/actions/ -- Server actions and API clients (44 files)

##### API client singletons
```
src/actions/api/adminSupabase.ts                       -- Supabase admin client (service role, bypasses RLS)
src/actions/api/supabase.ts                            -- Supabase client with Clerk-issued access token for RLS
src/actions/api/upstash.ts                             -- Upstash Redis client singleton
src/actions/api/qstash.ts                              -- Upstash QStash client singleton (ORPHAN: zero callers since FIX 13)
```

##### Auth and subscription checks
```
src/actions/server/authCheck.ts                        -- Validates userId matches Clerk session
src/actions/server/authCheckCronJob.ts                 -- Validates cron job secret key
src/actions/server/ensureUserExists.ts                 -- Syncs Clerk user to Supabase + Stripe on first protected visit
src/actions/checkActiveSubscription.ts                 -- Checks for active Stripe subscription in Supabase
src/actions/server/connections/checkAccountLimits.ts   -- Checks social account count against plan limits
src/actions/server/rateLimit/checkRateLimit.ts         -- Upstash sliding-window rate limiter with bypass secret
```

##### Client-side helpers
```
src/actions/client/getSignedViewUrl.ts                 -- Client-side helper to request signed view URLs from API
src/actions/client/signedUrlUpload.ts                  -- Client-side signed URL upload with XHR progress tracking
```

##### Server actions (with "use server" directive)
```
src/actions/server/accounts/disconnectAccountAction.ts       -- Disconnect social account
src/actions/server/accounts/disconnectSocialAccount.ts       -- Implementation: auth, rate-limit, delete, cleanup
src/actions/server/scheduleActions/schedulePost.ts           -- Schedule a post (delegates to _internal)
src/actions/server/scheduleActions/getScheduledPosts.ts      -- Fetch scheduled posts + group by batch
src/actions/server/scheduleActions/cancelScheduledPost.ts    -- Batch cancel scheduled posts
src/actions/server/scheduleActions/deleteScheduledPost.ts    -- Batch delete scheduled posts + media cleanup
src/actions/server/scheduleActions/resumeScheduledPost.ts    -- Batch resume cancelled posts
src/actions/server/scheduleActions/updateScheduledTime.ts    -- Batch update scheduled times
src/actions/server/data/deleteSupabaseFileAction.ts          -- Delete Supabase storage files (Clerk or cron auth)
src/actions/server/data/fetchSocialAccounts.ts               -- Fetch social accounts with auth + rate limit
src/actions/server/data/getSupabaseVideoFile.ts              -- Download video file from Supabase as Buffer
src/actions/server/data/mediaURL.ts                          -- @deprecated wrapper for buildProxiedTikTokMediaUrl
src/actions/server/data/pendingTikTokPulls.ts                -- CRUD for pending_tiktok_pulls table
src/actions/server/contentHistoryActions/getContentHistory.ts       -- Fetch content history with auth + rate limit
src/actions/server/contentHistoryActions/storeContentHistory.ts     -- Insert content_history record after successful post
src/actions/server/contentHistoryActions/storeFailedPost.ts         -- Insert failed_posts record after post failure
src/actions/server/stripe/checkOutSession.ts             -- Create Stripe checkout session
src/actions/server/stripe/checkUserSubscription.ts       -- Check user subscription status
src/actions/server/stripe/customerPortal.ts              -- Create Stripe customer portal session
src/actions/server/mcp/createApiKey.ts                   -- Generate MCP API key with subscription gate
src/actions/server/mcp/listApiKeys.ts                    -- List MCP API keys (prefix, name, dates)
src/actions/server/mcp/revokeApiKey.ts                   -- Revoke MCP API key by setting revoked_at
```

##### Internal actions (no auth, used by MCP + Inngest)
```
src/actions/server/_internal/data/deleteSupabaseFileAction.ts                  -- Delete files without auth (caller pre-verified)
src/actions/server/_internal/data/fetchSocialAccounts.ts                       -- Fetch social accounts without auth
src/actions/server/_internal/contentHistoryActions/getContentHistory.ts         -- Fetch content history without auth
src/actions/server/_internal/scheduleActions/schedulePost.ts                   -- Create scheduled post without auth
src/actions/server/_internal/scheduleActions/getScheduledPosts.ts              -- Fetch scheduled posts without auth
src/actions/server/_internal/scheduleActions/cancelScheduledPostBatch.ts       -- Batch cancel without auth
src/actions/server/_internal/scheduleActions/deleteScheduledPostBatch.ts       -- Batch delete + media cleanup without auth
src/actions/server/_internal/scheduleActions/resumeScheduledPostBatch.ts       -- Batch resume without auth
src/actions/server/_internal/scheduleActions/updateScheduledTimeBatch.ts       -- Batch reschedule without auth
```

##### Misplaced UI component
```
src/actions/ui/Theme-provider.tsx                      -- next-themes ThemeProvider wrapper (ORPHAN: not imported anywhere)
```

#### src/inngest/ -- Inngest functions (7 files)

```
src/inngest/client.ts                                          -- Inngest v4 client, id="sharetopus", maxRuntime from RUNTIME config
src/inngest/functions/scheduledPostsTick.ts                     -- Cron function (every minute): fetches due posts, dispatches post.due events
src/inngest/functions/scheduledPostsTickHelpers.ts              -- Helper: fetchDueScheduledPosts, markPostsAsQueued
src/inngest/functions/processSinglePost.ts                      -- Event-driven worker: processes one scheduled post on one platform
src/inngest/functions/processSinglePostHelpers.ts               -- Helpers: fetch/claim post, build signed URLs, call platform API, record status, cleanup
src/inngest/functions/tikTokPublishStatusPoll.ts                -- Polling worker: polls TikTok publish status until terminal (max 60 attempts)
src/inngest/functions/tikTokPublishStatusPollHelpers.ts         -- Helpers: resolve TikTok token, update content_history on failure, dispatch poll events
src/inngest/functions/platformErrors.ts                         -- PlatformPostOutcome type, error classification, retry policy
```

#### src/lib/api/ -- Platform API clients (~35 files)

##### Shared
```
src/lib/api/_shared/buildStreamingMultipartFormDataBody.ts     -- Streaming multipart/form-data builder (Pinterest video)
src/lib/api/ensureValidToken.ts                                -- Token refresh orchestrator for LinkedIn/Pinterest/TikTok (Instagram case MISSING, see F1)
```

##### Instagram
```
src/lib/api/instagram/data/exchangeInstagramCode.ts            -- Exchange OAuth code for access token
src/lib/api/instagram/data/getInstagramProfile.ts              -- Fetch Instagram user profile from Graph API
src/lib/api/instagram/data/refreshInstagramToken.ts            -- Refresh Instagram long-lived token (DEAD CODE: zero importers, F11)
src/lib/api/instagram/post/directPostForInstagramAccounts.ts   -- Direct post to Instagram (image/video as Reels)
src/lib/api/instagram/post/postToInstagram.ts                  -- Low-level Instagram Graph API post helper
src/lib/api/instagram/processAccounts/processInstagramAccounts.ts -- Batch process Instagram scheduled posts
src/lib/api/instagram/schedule/scheduleForInstagramAccounts.ts -- Schedule posts for Instagram accounts
```

##### LinkedIn
```
src/lib/api/linkedin/data/exchangeLinkedInCode.ts              -- Exchange OAuth code for access token
src/lib/api/linkedin/data/getLinkedInProfile.ts                -- Fetch LinkedIn user profile
src/lib/api/linkedin/data/refreshLinkedinToken.ts              -- Refresh LinkedIn OAuth token
src/lib/api/linkedin/post/directPostForLinkedInAccounts.ts     -- Direct post to LinkedIn (text/image/video with rate limit)
src/lib/api/linkedin/post/postToLinkedIn.ts                    -- Low-level LinkedIn API post helper (UGC API)
src/lib/api/linkedin/processAccounts/processLinkedinAccounts.ts -- Batch process LinkedIn scheduled posts
src/lib/api/linkedin/schedule/scheduledForLinkedinAccounts.ts  -- Schedule posts for LinkedIn accounts (F14: misspelled filename)
```

##### Pinterest
```
src/lib/api/pinterest/data/exchangePinterestCode.ts            -- Exchange OAuth code for access token
src/lib/api/pinterest/data/getPinterestProfile.ts              -- Fetch Pinterest user profile
src/lib/api/pinterest/data/getPinterestBoards.ts               -- Fetch Pinterest boards for user
src/lib/api/pinterest/data/createPinterestBoard.ts             -- Create a new Pinterest board
src/lib/api/pinterest/data/refreshPinterestToken.ts            -- Refresh Pinterest OAuth token
src/lib/api/pinterest/post/directPostForPinterestAccounts.ts   -- Direct post to Pinterest (image/video)
src/lib/api/pinterest/post/postToPinterest.ts                  -- Pinterest post orchestrator (routes to image or video pin)
src/lib/api/pinterest/post/postImage.ts                        -- Create image pin via Pinterest API
src/lib/api/pinterest/post/createVideoPin.ts                   -- Create video pin with streaming multipart upload + polling
src/lib/api/pinterest/processAccounts/processPinterestAccounts.ts -- Batch process Pinterest scheduled posts
src/lib/api/pinterest/schedule/scheduleForPinterestAccounts.ts -- Schedule posts for Pinterest accounts
```

##### TikTok
```
src/lib/api/tiktok/data/exchangeTikTokCode.ts                 -- Exchange OAuth code for access token
src/lib/api/tiktok/data/getTikTokProfile.ts                   -- Fetch TikTok user profile
src/lib/api/tiktok/data/refreshTikTokToken.ts                 -- Refresh TikTok OAuth token
src/lib/api/tiktok/post/directPostForTikTokAccounts.ts        -- Direct post to TikTok with publish poll dispatch
src/lib/api/tiktok/post/postToTikTok.ts                       -- TikTok post orchestrator (routes to image or video)
src/lib/api/tiktok/post/postImage.ts                           -- TikTok image post via PULL_FROM_URL
src/lib/api/tiktok/post/postVideo.ts                           -- TikTok video post with cover timestamp handling
src/lib/api/tiktok/buildTikTokMediaUrl.ts                      -- Dual-mode media URL dispatcher (proxy vs supabase_direct)
src/lib/api/tiktok/buildProxiedTikTokMediaUrl.ts               -- Proxy mode: build /api/media URL for TikTok pull
src/lib/api/tiktok/buildSupabaseDirectTikTokMediaUrl.ts        -- Direct mode: Supabase signed URL bypassing Vercel proxy
src/lib/api/tiktok/getTikTokPublishStatus.ts                   -- Poll TikTok /v2/post/publish/status/fetch/ endpoint
src/lib/api/tiktok/processAccounts/processTiktokAccounts.ts    -- Batch process TikTok scheduled posts
src/lib/api/tiktok/schedule/scheduleForTikTokAccounts.ts       -- Schedule posts for TikTok accounts
```

##### Templates (scaffolds for future platforms)
```
src/lib/api/facebook/post/directPostForFacebookAccountsTemplate.ts  -- TEMPLATE: Facebook direct-post scaffold (NOT wired, zero importers)
src/lib/api/twitter/post/directPostForTwitterAccountsTemplate.ts    -- TEMPLATE: Twitter/X direct-post scaffold (NOT wired, zero importers)
```

#### src/lib/mcp/ -- MCP server (22 files)

##### Core
```
src/lib/mcp/auth.ts                              -- Resolves Bearer token to McpPrincipal (API key or Clerk OAuth)
src/lib/mcp/context.ts                           -- Extracts McpPrincipal from tool handler context
src/lib/mcp/entitlement.ts                       -- Per-tool plan tier gate + monthly quota enforcement
src/lib/mcp/audit.ts                             -- Append-only mcp_audit_log writer with secret redaction
src/lib/mcp/tokens.ts                            -- MCP API key generation (stp_mcp_ prefix), SHA-256 hashing
```

##### Tools (14)
```
src/lib/mcp/tools/index.ts                       -- Registers all 14 MCP tool handlers
src/lib/mcp/tools/listConnections.ts              -- List connected social accounts
src/lib/mcp/tools/listScheduledPosts.ts           -- List scheduled posts
src/lib/mcp/tools/listContentHistory.ts           -- List posted content history
src/lib/mcp/tools/schedulePost.ts                 -- Schedule a single post (Starter+)
src/lib/mcp/tools/bulkSchedule.ts                 -- Bulk schedule up to 30 posts (Creator+)
src/lib/mcp/tools/cancelScheduledPosts.ts         -- Cancel scheduled posts
src/lib/mcp/tools/resumeScheduledPosts.ts         -- Resume cancelled posts
src/lib/mcp/tools/reschedulePosts.ts              -- Reschedule posts to new time
src/lib/mcp/tools/deleteScheduledPosts.ts         -- Delete scheduled posts + media cleanup
src/lib/mcp/tools/getAccountAnalytics.ts          -- Get account analytics (Creator+)
src/lib/mcp/tools/generatePostDraft.ts            -- Generate post draft via AI (Pro only)
src/lib/mcp/tools/attachMediaFromUrl.ts           -- Attach media from external URL
src/lib/mcp/tools/requestAccountReauthLink.ts     -- Request re-auth link for expired account
src/lib/mcp/tools/listBillingSummary.ts           -- List billing/subscription summary
```

##### Resources (3)
```
src/lib/mcp/resources/index.ts                    -- Registers all 3 resource handlers
src/lib/mcp/resources/connections.ts              -- Read-only resource: connected social accounts
src/lib/mcp/resources/contentHistory.ts           -- Read-only resource: content history
src/lib/mcp/resources/scheduledPosts.ts           -- Read-only resource: scheduled posts
```

##### Prompts (3)
```
src/lib/mcp/prompts/index.ts                     -- Registers all 3 prompt templates
src/lib/mcp/prompts/planWeekForPlatform.ts        -- Plan a week's content for a platform
src/lib/mcp/prompts/repurposePost.ts              -- Repurpose a post for another platform
src/lib/mcp/prompts/auditCalendar.ts              -- Audit content calendar
```

#### src/lib/types/ -- Shared types (6 files)

```
src/lib/types/database.types.ts              -- Supabase generated types: all table Row/Insert/Update types
src/lib/types/dbTypes.ts                     -- Type aliases (User, SocialAccount, ScheduledPost, ContentHistory, etc.) + platform enums + option interfaces
src/lib/types/LinkedinProfile.ts             -- LinkedIn user profile interface
src/lib/types/PinterestProfile.ts            -- Pinterest user profile type
src/lib/types/TikTokProfile.ts               -- TikTok user profile type
src/lib/types/SchedulePostData.ts            -- SchedulePostData interface for post scheduling
src/lib/types/plans.ts                       -- Plan pricing, tier hierarchy, price-to-tier mapping, account/storage limits
```

#### src/lib/ -- Utility files

```
src/lib/utils.ts                             -- cn() helper: clsx + tailwind-merge
src/lib/stripe.ts                            -- Stripe client singleton
src/lib/jobs/runtimeConfig.ts                -- RUNTIME config object: maxDuration, concurrency, poll intervals, file size limits
```

#### src/middleware.ts

```
src/middleware.ts                             -- Clerk middleware: public routes for MCP/OAuth, protected routes for app pages
```

#### src/hooks/

```
src/hooks/use-mobile.ts                      -- useIsMobile() hook: media query breakpoint at 768px
```

#### src/components/ -- React components (~100 files)

##### UI primitives (33 shadcn/ui components)
```
src/components/ui/alert.tsx                  src/components/ui/alert-dialog.tsx
src/components/ui/avatar.tsx                 src/components/ui/badge.tsx
src/components/ui/breadcrumb.tsx             src/components/ui/button.tsx
src/components/ui/calendar.tsx               src/components/ui/card.tsx
src/components/ui/chart.tsx                  src/components/ui/checkbox.tsx
src/components/ui/dialog.tsx                 src/components/ui/drawer.tsx
src/components/ui/dropdown-menu.tsx          src/components/ui/input.tsx
src/components/ui/label.tsx                  src/components/ui/navigation-menu.tsx
src/components/ui/popover.tsx                src/components/ui/progress.tsx
src/components/ui/radio-group.tsx            src/components/ui/select.tsx
src/components/ui/separator.tsx              src/components/ui/sheet.tsx
src/components/ui/sidebar.tsx                src/components/ui/skeleton.tsx
src/components/ui/slider.tsx                 src/components/ui/sonner.tsx
src/components/ui/switch.tsx                 src/components/ui/table.tsx
src/components/ui/tabs.tsx                   src/components/ui/textarea.tsx
src/components/ui/toggle.tsx                 src/components/ui/toggle-group.tsx
src/components/ui/tooltip.tsx
```

##### Sidebar navigation
```
src/components/sidebar/app-sidebar.tsx       -- Main app sidebar with navigation groups
src/components/sidebar/Site-Header.tsx       -- Top header bar with breadcrumb
src/components/sidebar/nav-accounts.tsx      -- Sidebar nav: accounts section
src/components/sidebar/nav-create.tsx        -- Sidebar nav: create post section
src/components/sidebar/nav-post.tsx          -- Sidebar nav: posts/scheduled section
src/components/sidebar/nav-user.tsx          -- Sidebar nav: user profile section
src/components/sidebar/ModeToggle.tsx        -- Dark/light mode toggle (ORPHAN: zero importers)
```

##### Marketing page components
```
src/components/marketing-page/nav-bar/nav-bar.tsx            -- Marketing navbar
src/components/marketing-page/nav-bar/nav-items.tsx          -- Navbar menu items
src/components/marketing-page/hero/hero.tsx                  -- Hero section with animated testimonial
src/components/marketing-page/hero/AnimatedTestimonial.tsx   -- Animated testimonial carousel
src/components/marketing-page/HeroVisuals.tsx                -- Hero visual/demo images
src/components/marketing-page/AlternativesSection.tsx        -- Alternatives comparison section
src/components/marketing-page/comparaison/FeaturesSection.tsx -- Features comparison table
src/components/marketing-page/comparaison/ProblemsSection.tsx -- Problems solved section
src/components/marketing-page/comparaison/StatsSection.tsx   -- Statistics section
src/components/marketing-page/details/platformList.tsx       -- Platform list with icons
src/components/marketing-page/pricing.tsx                    -- Pricing cards with Stripe checkout
src/components/marketing-page/testimonial.tsx                -- Testimonial cards section
src/components/marketing-page/partners.tsx                   -- Partners/integrations logos (ORPHAN: zero importers)
src/components/marketing-page/footer.tsx                     -- Footer component
```

##### Core feature components

**Accounts / Connections:**
```
src/components/core/accounts/connectAccountsButton/ConnectInstagramButton.tsx  -- Instagram OAuth connect
src/components/core/accounts/connectAccountsButton/ConnectLinkedInButton.tsx   -- LinkedIn OAuth connect
src/components/core/accounts/connectAccountsButton/ConnectPinterestButton.tsx  -- Pinterest OAuth connect
src/components/core/accounts/connectAccountsButton/ConnectTikTokButton.tsx     -- TikTok OAuth connect
src/components/core/accounts/connectAccountsButton/ConnectionLimitModal.tsx    -- Modal when account limit reached
src/components/core/accounts/NoAccountsMessage.tsx                             -- Empty state: no accounts
src/components/core/accounts/pageUi/ConnectedAccountsBadge.tsx                 -- Badge: connected account count
src/components/core/accounts/pageUi/SocialAccountBadge.tsx                     -- Account badge with disconnect
```

**Create post:**
```
src/components/core/create/SocialPostForm/SocialPostForm.tsx                   -- Main post creation form
src/components/core/create/SocialPostForm/sections/AccountSelector.tsx         -- Platform/account multi-select
src/components/core/create/SocialPostForm/sections/CaptionsTab.tsx             -- Per-account caption editing
src/components/core/create/SocialPostForm/sections/PinterestSettingsTab.tsx    -- Pinterest board/link settings
src/components/core/create/SocialPostForm/sections/SchedulingPanel.tsx         -- Schedule date/time picker
src/components/core/create/SocialPostForm/hooks/useAccountContent.ts           -- Hook: per-account content state
src/components/core/create/SocialPostForm/hooks/usePinterestBoards.ts          -- Hook: fetches Pinterest boards
src/components/core/create/SocialPostForm/media/convertPngToJpeg.ts            -- Client PNG-to-JPEG conversion
src/components/core/create/SocialPostForm/state/defaults.ts                    -- Default form state values
src/components/core/create/SocialPostForm/validation/checkFormSubmission.ts    -- Pre-submission validation
src/components/core/create/action/handleSocialMediaPost/handleSocialMediaPost.ts -- Server action: post orchestrator (F24)
src/components/core/create/action/handleSocialMediaPost/successMessage.ts      -- Toast success message formatter
src/components/core/create/action/handleSocialMediaPost/validateContent.ts     -- Content validation
src/components/core/create/action/getMimeTypeFromFileName.ts                   -- MIME type from file extension
src/components/core/create/action/media/extractVideoThumbnail.ts               -- Video thumbnail extractor (ORPHAN)
src/components/core/create/action/media/uploadMedia.ts                         -- Media upload orchestrator
src/components/core/create/constants/captionLimits.ts                          -- Platform caption char limits
src/components/core/create/constants/constants.ts                              -- General create-post constants
src/components/core/create/constants/uploadLimits.ts                           -- Per-plan upload size limits
src/components/core/create/upload/ImageUpload .tsx                             -- Image upload dropzone (F3: space in name)
src/components/core/create/upload/VideoUpload.tsx                              -- Video upload dropzone
src/components/core/create/upload/VideoCoverSelector.tsx                       -- Video cover frame selector
src/components/core/create/upload/VideoThumbnailPreview.tsx                    -- Video thumbnail preview
src/components/core/create/NoAccountAvaible.tsx                                -- Empty state: no accounts (F16: typo)
```

**Scheduled posts:**
```
src/components/core/scheduled/PostsGrid.tsx                                    -- Scheduled posts grid
src/components/core/scheduled/BatchedPostCard.tsx                              -- Card for batch of scheduled posts
src/components/core/scheduled/EmptyContent.tsx                                 -- Empty state for scheduled posts
src/components/core/scheduled/MediaPreview.tsx                                 -- Media preview (ORPHAN: zero importers)
src/components/core/scheduled/PlatformContentDropdown/PlatformContentDropdown.tsx -- Expandable platform content
```

**Posted content history:**
```
src/components/core/posted/renderPosts.tsx                   -- Renders grouped content history
src/components/core/posted/ContentHistoryCard.tsx            -- Individual posted content card
src/components/core/posted/EmptyContentHistory.tsx           -- Empty state for content history
src/components/core/posted/noData.tsx                        -- "No data" placeholder
```

##### Shared components
```
src/components/AvatarWithFallback.tsx          -- Avatar with initials fallback
src/components/SocialAvatarWrapper.tsx         -- Social platform avatar with icon overlay
src/components/ComingSoon.tsx                  -- "Coming soon" placeholder card
src/components/SubscriptionPrompt.tsx          -- Paywall prompt for non-subscribers
src/components/RateLimitError.tsx              -- Rate limit error display
src/components/renderFilePreview.tsx           -- File preview renderer (image/video)
src/components/icons/allPlatformsIcons.tsx     -- SVG icon components for all social platforms
```

##### Suspense skeletons
```
src/components/suspense/account/Placeholders.tsx              -- Accounts page loading skeleton
src/components/suspense/create/SocialPostFormSkeleton.tsx      -- Create post form loading skeleton
src/components/suspense/posted/ContentHistorySkeleton.tsx      -- Posted content loading skeleton
src/components/suspense/scheduled/ScheduledPostsSkeleton.tsx   -- Scheduled posts loading skeleton
```

### Entry points

| Type | Count | Files |
|---|---|---|
| Route handlers (`route.ts`) | 24 | Listed under src/app/ above |
| Server actions (`"use server"`) | 22 | Listed under src/actions/ + some in src/lib/api/ + handleSocialMediaPost |
| Pages + layouts | 19 | 2 layouts + 17 pages (including error.tsx) |
| Inngest functions | 3 | `scheduledPostsTick`, `processSinglePost`, `tikTokPublishStatusPollWorker` |
| MCP tools | 14 | Listed under src/lib/mcp/tools/ |
| MCP resources | 3 | connections, contentHistory, scheduledPosts |
| MCP prompts | 3 | planWeekForPlatform, repurposePost, auditCalendar |

### Candidate orphans (8 files with zero importers that are not entry points)

| File | Notes |
|---|---|
| `src/actions/api/qstash.ts` | QStash client, dead since FIX 13 (F7) |
| `src/actions/ui/Theme-provider.tsx` | ThemeProvider wrapper, never imported (F13) |
| `src/components/sidebar/ModeToggle.tsx` | Dark mode toggle, never imported |
| `src/components/marketing-page/partners.tsx` | Partners logos, never imported |
| `src/components/core/create/action/media/extractVideoThumbnail.ts` | Video thumbnail extractor, never imported |
| `src/components/core/scheduled/MediaPreview.tsx` | Scheduled post media preview, never imported |
| `src/lib/api/facebook/post/directPostForFacebookAccountsTemplate.ts` | Template scaffold, intentionally unwired |
| `src/lib/api/twitter/post/directPostForTwitterAccountsTemplate.ts` | Template scaffold, intentionally unwired |

---

## Part 3: Duplicate code audit

### Status of prior recon findings (RECON_CODEBASE_AUDIT.md at HEAD `4661199`)

| Finding | Description | Status since FIX 16 |
|---|---|---|
| **F1** | Instagram token refresh is dead code | **Still open.** `ensureValidToken.ts:59` switch still has no `case "instagram"`. `refreshInstagramToken` still has zero importers. |
| **F2** | Throws across function boundaries (3 platforms) | **Still open.** 23 throw sites across 7 files unchanged. |
| **F3** | Files with spaces in names | **Partially resolved.** `PinterestProfile .ts` space fixed. `ImageUpload .tsx` space remains at `src/components/core/create/upload/ImageUpload .tsx`. |
| **F4** | Unauthenticated storage view URL endpoint | **Still open.** `generate-view-url/route.ts` still has zero auth checks. |
| **F5** | Duplicate SchedulePostData type | **Still open.** `dbTypes.ts:140` version still exists with zero importers. `SchedulePostData.ts:4` canonical version still imported by 2 files. |
| **F6** | Platform code duplication (4 platforms) | **Worsened.** FIX 17 added 2 new template files (Facebook/Twitter, 90 lines total). Core 4-platform duplication unchanged. Total directPostFor lines went from 986 to 844 (net shrink per file, but templates added). |
| **F7** | QStash client never called | **Still open.** `src/actions/api/qstash.ts` still zero callers. |
| **F8** | Dead types in dbTypes.ts | **Still open.** Unable to verify individual types without exhaustive grep. |
| **F9** | Profile types scattered | **Still open.** 3 separate files + 1 inline in dbTypes + 1 dead `SocialProfile` type. |
| **F10** | createSecureMediaUrlSigned misnamed | **Status changed.** Now `@deprecated` at `src/actions/server/data/mediaURL.ts:6` and delegates to `buildProxiedTikTokMediaUrl`. Still called by `handleSocialMediaPost.ts:297`. |
| **F11** | refreshInstagramToken exported, never imported | **Still open.** Related to F1. |
| **F12** | Empty platform stubs | **Worsened.** FIX 17 added 2 template files with actual scaffold code (45 lines each), but the original empty stubs (`facebook/facebook.ts`, `twitter/twitter.ts`) status unverified. |
| **F13** | ThemeProvider in actions/ui/ | **Still open.** `src/actions/ui/Theme-provider.tsx` still in `actions/`. |
| **F14** | LinkedIn schedule file naming | **Still open.** `scheduledForLinkedinAccounts.ts` (past tense, lowercase i). |
| **F15** | French/English mixed logging | **Still open.** Not addressed by FIX 17/17.1/17.2. |
| **F16** | Typos in code | **Still open.** Not addressed. |
| **F17** | Commented-out code blocks | **Still open.** |
| **F18** | Empty SidebarMenuItem in nav-post | **Still open.** |
| **F19** | TikTok connect button timeout | **Still open.** |
| **F20** | Em-dashes in source files | **Still open.** |
| **F21** | 14 schema tables with zero consumers | **Still open** (deferred by design). |
| **F22** | user_id column in stripe tables | **N/A** (intentional, not a bug). |
| **F23** | STRIPE_PUBLISHABLE_KEY in .env.example | **Still open.** |
| **F24** | handleSocialMediaPost lives in components tree | **Still open.** |

**Summary:** 1 finding partially resolved (F3), 1 finding improved (F10), 1 finding worsened (F6), 2 not applicable (F21, F22). The remaining 20 findings are still open and unchanged.

### Function-level duplication

#### directPostFor*.ts files (6 files, 934 total lines)

| File | Lines | Status |
|---|---|---|
| `src/lib/api/instagram/post/directPostForInstagramAccounts.ts` | 193 | Active |
| `src/lib/api/linkedin/post/directPostForLinkedInAccounts.ts` | 251 | Active |
| `src/lib/api/pinterest/post/directPostForPinterestAccounts.ts` | 185 | Active |
| `src/lib/api/tiktok/post/directPostForTikTokAccounts.ts` | 215 | Active |
| `src/lib/api/facebook/post/directPostForFacebookAccountsTemplate.ts` | 45 | Template (FIX 17) |
| `src/lib/api/twitter/post/directPostForTwitterAccountsTemplate.ts` | 45 | Template (FIX 17) |

**Structural similarity of the 4 active files: ~65% shared.** All 4 follow this identical skeleton:
1. Destructure config (5-10 lines)
2. Validate accountContent (5-8 lines)
3. Call `ensureValidToken(account)` (7-10 lines)
4. Platform-specific validation (5-10 lines)
5. Call `postTo{Platform}(...)` with platform-specific params (5-15 lines)
6. Console logging of result (5-8 lines)
7. On success: call `storeContentHistory(...)` with nearly identical shape (15-20 lines)
8. Check historyResult, return error if failed (5-8 lines)
9. On failure: console.error + return error (5-8 lines)
10. Outer catch: return error (5-8 lines)

**Key platform-specific divergences:**
- LinkedIn: extra `checkRateLimit` (lines 87-105), `getSupabaseVideoFile` buffer download (lines 107-123), `isCronJob` branching
- TikTok: `insertPendingTikTokPull` + `dispatchTikTokPublishPollEvent` (lines 153-181)
- Instagram: `account_identifier` validation (lines 74-83)
- Pinterest: `boards` config in `storeContentHistory` extra (lines 132-133)

#### processAccounts files (4 files, 705 total lines)

| File | Lines |
|---|---|
| `src/lib/api/instagram/processAccounts/processInstagramAccounts.ts` | 197 |
| `src/lib/api/linkedin/processAccounts/processLinkedinAccounts.ts` | 169 |
| `src/lib/api/pinterest/processAccounts/processPinterestAccounts.ts` | 179 |
| `src/lib/api/tiktok/processAccounts/processTiktokAccounts.ts` | 160 |

**Structural similarity: ~85%.** Identical skeleton: iterate accounts, find accountContent, validate, branch scheduled vs direct, count results.

#### scheduleFor files (4 files, 399 total lines)

| File | Lines |
|---|---|
| `src/lib/api/instagram/schedule/scheduleForInstagramAccounts.ts` | 91 |
| `src/lib/api/linkedin/schedule/scheduledForLinkedinAccounts.ts` | 100 |
| `src/lib/api/pinterest/schedule/scheduleForPinterestAccounts.ts` | 114 |
| `src/lib/api/tiktok/schedule/scheduleForTikTokAccounts.ts` | 94 |

**Structural similarity: ~90%.** Only `postOptions` shape and platform name differ.

**NEW BUG FOUND:** `src/lib/api/tiktok/schedule/scheduleForTikTokAccounts.ts:91` says `"Failed to schedule Pinterest posts"` instead of `"Failed to schedule TikTok posts"`. Copy-paste error.

#### Route handlers (16 platform routes, 2,358 total lines)

| Group | Files | Lines | Similarity |
|---|---|---|---|
| Process routes | 4 | 212 | ~98% identical (53 lines each, differ only in platform name) |
| Post routes | 4 | 140 | ~100% identical (35 lines each, differ only in import + platform name) |
| Initiate routes | 4 | 564 | ~70% shared (OAuth URL + scopes differ) |
| Connect routes | 4 | 1,442 | ~50% shared (OAuth flow, profile fetch, token storage differ) |

### Type-level duplication

| Duplicate | Location 1 | Location 2 | Status |
|---|---|---|---|
| **SchedulePostData** | `src/lib/types/dbTypes.ts:140` (7 fields, 0 importers) | `src/lib/types/SchedulePostData.ts:4` (10 fields, canonical) | Should consolidate: delete dbTypes version |
| **ScheduleResult** | Defined at `src/lib/api/pinterest/schedule/scheduleForPinterestAccounts.ts:5-9` | Imported by 8+ files across all platforms | Should move to `src/lib/types/` |
| **PostOptions** | `src/lib/types/dbTypes.ts:88` (`PlatformOptions` nested) | `src/inngest/functions/processSinglePostHelpers.ts:271` (flat `PostOptions`) | Should consolidate |
| **AccountError/ContentInfo/BoardInfo** | `src/components/core/create/action/handleSocialMediaPost/handleSocialMediaPost.ts:15-43` | Imported by all 4 processAccounts files | Should move to `src/lib/types/` |
| **Profile types** | 3 separate files + 1 inline in dbTypes + 1 dead `SocialProfile` | Scattered across `src/lib/types/` | Should consolidate into one location |

### Helper function duplication

| Helper | Status | Details |
|---|---|---|
| **Token refresh** | 3 near-identical files (LinkedIn, Pinterest, TikTok) + 1 different (Instagram) | LinkedIn + Pinterest are ~95% identical, differ only in env vars and endpoint URL. Should consolidate into `refreshOAuthToken(config)`. Instagram is genuinely different (GET, no refresh_token). |
| **ensureValidToken** | Centralized, single file | Good. But Instagram case still missing (F1). |
| **TikTok media URL builders** | 3-function layered hierarchy (dispatcher + 2 modes) + 1 deprecated wrapper | Justified architecture. Only `createSecureMediaUrlSigned` should be removed (deprecated). |
| **storeFailedPost** | Centralized at `src/actions/server/contentHistoryActions/storeFailedPost.ts:25` | Good. Single function, single caller. Improved by FIX 17. |
| **storeContentHistory** | Centralized | Good. Single implementation, multiple callers. |
| **deleteSupabaseFile** | Public + internal split | Justified. Deliberate auth trust boundary. |

### New duplicates from recent FIXes

| Item | Source | Category |
|---|---|---|
| **`buildStreamingMultipartFormDataBody`** | `src/lib/api/_shared/buildStreamingMultipartFormDataBody.ts` (1 file). Called by Pinterest `createVideoPin.ts`. | **Justified** -- single-platform helper, correctly placed in `_shared`. |
| **TikTok media URL hierarchy** (3 functions) | `buildTikTokMediaUrl.ts`, `buildProxiedTikTokMediaUrl.ts`, `buildSupabaseDirectTikTokMediaUrl.ts` | **Justified** -- proper layered architecture with mode dispatch. |
| **`createSecureMediaUrlSigned`** (deprecated) | `src/actions/server/data/mediaURL.ts:6-27`. Still called by `handleSocialMediaPost.ts:297`. | **Wrapper/legacy** -- should remove, migrate caller to `buildTikTokMediaUrl`. |
| **Facebook template** | `src/lib/api/facebook/post/directPostForFacebookAccountsTemplate.ts` (45 lines, zero importers) | **Should remove** -- scaffold that will drift. Import couples to Pinterest type. |
| **Twitter template** | `src/lib/api/twitter/post/directPostForTwitterAccountsTemplate.ts` (45 lines, zero importers) | **Should remove** -- scaffold that will drift. Import couples to Pinterest type. |
| **`storeFailedPost` centralized** | Single definition at `src/actions/server/contentHistoryActions/storeFailedPost.ts:25` | **Justified** -- centralization complete (improved by FIX 17). |
| **Copy-paste error in TikTok schedule** | `scheduleForTikTokAccounts.ts:91` says "Pinterest" | **Bug** -- fix error message. |

### F6 platform deduplication scope (for FIX 22 planning)

#### directPostFor files: line budget

| Platform | Total | Estimated shared skeleton | Estimated platform-specific | Key unique logic |
|---|---|---|---|---|
| Instagram | 193 | ~130 (67%) | ~63 (33%) | `account_identifier` check, `instagramPostType` mapping, `altText`/`shareToFeed` |
| LinkedIn | 251 | ~135 (54%) | ~116 (46%) | `checkRateLimit`, `getSupabaseVideoFile` buffer, `memberUrn`, `isCronJob` |
| Pinterest | 185 | ~125 (68%) | ~60 (32%) | `boards` param, board data in history extra |
| TikTok | 215 | ~115 (53%) | ~100 (47%) | `tiktokMediaUrl`, `insertPendingTikTokPull`, `dispatchTikTokPublishPollEvent`, status field |
| **Totals** | **844** | **~505 (60%)** | **~339 (40%)** | |

#### Conceptual generic function signature

```typescript
type DirectPostConfig<TPlatformParams> = {
  account: SocialAccount;
  mediaPath: string;
  coverTimestamp: number;
  mediaType: string;
  accountContent: { accountId: string; title: string; description: string; isCustomized: boolean };
  userId: string | null;
  batchId: string;
  postType: "image" | "video" | "text";
  fileName: string;
  scheduledPostId?: string;
  platformParams: TPlatformParams;
};

type PlatformPostAdapter<TPlatformParams> = {
  name: string;
  validate: (config, account) => ScheduleResult | null;
  prepareMedia?: (config) => Promise<string | Buffer | null>;
  post: (token, config, media) => Promise<PlatformPostResult>;
  buildHistoryRecord: (config, postResult) => ContentHistoryInput;
  onSuccess?: (config, postResult, historyId) => Promise<void>;
};

async function directPostForAccount<T>(
  config: DirectPostConfig<T>,
  adapter: PlatformPostAdapter<T>
): Promise<ScheduleResult>
```

**Estimated savings:** ~350-400 lines from directPostFor alone. Each platform file shrinks from 185-251 lines to ~40-80 lines of adapter configuration.

#### Full F6 deduplication scope across all categories

| Category | Current lines | Estimated after consolidation | Savings |
|---|---|---|---|
| directPostFor (4 active) | 844 | ~450 | ~394 |
| processAccounts | 705 | ~300 | ~405 |
| scheduleFor | 399 | ~150 | ~249 |
| Process routes | 212 | ~60 (factory) | ~152 |
| Post routes | 140 | ~40 (factory) | ~100 |
| Refresh token (LinkedIn + Pinterest) | 132 | ~75 (generic + config) | ~57 |
| **Total** | **2,432** | **~1,075** | **~1,357** |

---

## Conclusion

1. **Inngest poll worker is correctly defined and registered**, but the event dispatch uses `inngest.send()` (HTTP call) instead of `step.sendEvent()` (step primitive). This is the most likely cause of the worker never executing. Secondary cause: Inngest Cloud may need re-syncing after the FIX 17.1 deploy.

2. **Immediate action:** Check Inngest Dashboard for function count + trigger "Sync app"; check Vercel logs for dispatch failure messages; check `INNGEST_EVENT_KEY` env var. Then refactor to `step.sendEvent()` (Option A).

3. **Of 24 prior recon findings, 20 remain open, 1 partially resolved (F3), 1 improved (F10), 1 worsened (F6).** No findings were fully resolved by FIX 17/17.1/17.2.

4. **New bug found:** `scheduleForTikTokAccounts.ts:91` copy-paste error says "Pinterest" instead of "TikTok" in the error message.

5. **F6 deduplication scope is ~1,357 lines** across 22 files that could consolidate to ~1,075 lines using generic helpers + platform adapters. This is the largest technical debt item and the target for FIX 22.

## What was NOT investigated

- **Vercel deployment state:** Cannot access Vercel dashboard from local environment. The latest deployed commit is unverifiable.
- **Inngest Dashboard function list:** Cannot introspect (401 without signing key). Whether Inngest Cloud has 2 or 3 functions registered is unverified.
- **Vercel production logs:** Cannot access. Whether `[dispatchTikTokPublishPollEvent] Dispatch failed:` messages appear is unknown.
- **`INNGEST_EVENT_KEY` environment variable:** Cannot verify its existence in Vercel's production env vars.
- **Inngest v4 `inngest.send()` inside `step.run()` behavior:** No official Inngest documentation explicitly addresses whether `inngest.send()` (HTTP call) works correctly inside a `step.run()` callback with checkpointing. The recommendation is `step.sendEvent()`, but the failure mode of `inngest.send()` in this context is undocumented.
- **Database state verification:** The `pending_tiktok_pulls` table contents were not queried. Whether rows exist with `attempt_count = 0` and `last_polled_at = NULL` (as the operator reports) is taken on faith.
- **Individual F8 dead types:** Not exhaustively re-grepped. Status carried over from prior recon.
- **i18n wiring:** `i18n-config.ts` has zero importers in `src/`, but Next.js may auto-detect it. Not verified.
