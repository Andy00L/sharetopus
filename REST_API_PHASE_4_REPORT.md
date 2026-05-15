# REST API Phase 4 Report -- Media + Analytics + Content History + Usage

**Branch:** main (direct commit)
**Commit:** pending
**Build state:** green (tsc --noEmit + npm run build)
**Generated:** 2026-05-15

## Summary

Phase 4 adds 8 new REST endpoints covering media management (upload URL, attach from URL, view URL, reference-aware delete), analytics, content history, and usage/billing. All media endpoints reuse the same pure helpers that web and MCP already use. The catch-all `[...path]` route pattern handles storage paths containing slashes. Usage endpoint excludes Stripe internal fields. Analytics endpoints ship with empty data (analytics_metrics table not yet populated).

## Files Created

| File | Lines | Purpose |
|---|---|---|
| src/lib/api/rest/dto/toAnalyticsDTO.ts | 36 | Maps analytics_metrics row to AnalyticsDTO |
| src/lib/api/rest/dto/toContentHistoryDTO.ts | 38 | Maps content_history row to ContentHistoryDTO |
| src/lib/api/rest/dto/toUsageDTO.ts | 58 | Builds UsageDTO from subscription + quotas + storage |
| src/lib/api/rest/validation/mediaSchemas.ts | 30 | Zod schemas for upload-url, attach-from-url, view-url |
| src/lib/api/rest/validation/analyticsSchemas.ts | 42 | Zod schemas for analytics, content-history queries |
| src/app/api/v1/media/upload-url/route.ts | 73 | POST: signed upload URL |
| src/app/api/v1/media/attach-from-url/route.ts | 128 | POST: download + upload from URL |
| src/app/api/v1/media/[...path]/route.ts | 144 | GET: view URL, DELETE: reference-aware delete |
| src/app/api/v1/analytics/route.ts | 90 | GET: account-wide analytics |
| src/app/api/v1/posts/[id]/analytics/route.ts | 100 | GET: per-post analytics |
| src/app/api/v1/content-history/route.ts | 80 | GET: published content history |
| src/app/api/v1/usage/route.ts | 90 | GET: quotas + storage usage |

## Reuse of Existing Helpers

| Endpoint | Reused helper | Source |
|---|---|---|
| POST /v1/media/upload-url | generateServerSignedUploadUrl | src/actions/server/data/ |
| POST /v1/media/attach-from-url | safeUserFetch | src/lib/mcp/_shared/ |
| POST /v1/media/attach-from-url | getUploadLimitsForPrincipal | src/lib/mcp/_shared/ |
| POST /v1/media/attach-from-url | enforceStorageQuota | src/lib/mcp/_shared/ |
| GET /v1/media/[...path] | getServerSignedViewUrl | src/actions/server/data/ |
| DELETE /v1/media/[...path] | deleteSupabaseFile | src/actions/server/data/storageFiles/ |
| GET /v1/usage | checkActiveSubscription | src/actions/ |
| GET /v1/usage | currentQuotaPeriod | src/lib/mcp/_shared/ |
| GET /v1/usage | get_user_storage_bytes RPC | Postgres function |

## response_summary Enrichment

| Endpoint | Audit summary keys |
|---|---|
| POST /v1/media/upload-url | storage_path, expires_in_seconds |
| POST /v1/media/attach-from-url | storage_path, content_type, size_bytes |
| GET /v1/media/[...path] | storage_path, expires_in_seconds |
| DELETE /v1/media/[...path] | storage_path, deleted |
| GET /v1/analytics | count, days, platform |
| GET /v1/posts/[id]/analytics | post_id, content_id, metric_count |
| GET /v1/content-history | count, platform |
| GET /v1/usage | plan, action_count, storage_bytes_used |

## attach_media_from_url Integration

Option B: REST handler orchestrates pure helpers directly (safeUserFetch, getUploadLimitsForPrincipal, enforceStorageQuota, adminSupabase.storage.upload). Same pattern as upload-url where web route and MCP tool independently call the shared helper. No code duplication since the reusable building blocks are already extracted.

## analytics_metrics Status

Empty (no cron populates this table). Endpoints ship and return data:[] until the analytics pipeline is built (separate phase).

## Catch-All Route Pattern

Next.js requires catch-all `[...path]` to be the last segment. The view-url endpoint was moved from `[...path]/view-url/route.ts` (invalid) to a GET handler in `[...path]/route.ts` alongside the DELETE handler. The GET handler generates a signed view URL; the DELETE handler performs reference-aware deletion.

## Invariant Verification

| # | Check | Result |
|---|---|---|
| I1 | New endpoint files exist | PASS (7 files, 8 handlers) |
| I2 | Media reuses shared helpers | PASS |
| I3 | Usage uses currentQuotaPeriod | PASS |
| I4 | Usage uses get_user_storage_bytes | PASS |
| I5 | No throws in v1 handlers | PASS |
| I6 | No any / as unknown as | PASS |
| I7 | No em-dash | PASS |
| I8 | No Stripe internals in usage DTO | PASS (only in JSDoc) |
| I9 | auditSummary on every handler | PASS |
| I10 | Build clean (tsc + npm run build) | PASS |
| I11 | MCP regression | PASS |
| I12 | No migration files | PASS |
| I13 | Path ownership check | PASS |

## Edge Cases Handled

| # | Endpoint | Edge case | File |
|---|---|---|---|
| 1 | POST /v1/media/upload-url | content_type not in allowlist | Delegated to generateServerSignedUploadUrl |
| 2 | POST /v1/media/upload-url | size > per-file cap | Delegated to generateServerSignedUploadUrl |
| 3 | POST /v1/media/upload-url | storage quota exceeded | Delegated (returns 403) |
| 4 | POST /v1/media/attach-from-url | SSRF (internal IP) | safeUserFetch blocks |
| 5 | POST /v1/media/attach-from-url | oversized file | Stream-based byte counting |
| 6 | POST /v1/media/attach-from-url | 3xx redirect | safeUserFetch rejects |
| 7 | GET /v1/media/[path] | path traversal (..) | Validation in extractStoragePath |
| 8 | GET /v1/media/[path] | not owned | principalId prefix check |
| 9 | DELETE /v1/media/[path] | file referenced | deleted:false returned |
| 10 | DELETE /v1/media/[path] | orphan file | deleted:true |
| 11 | GET /v1/analytics | empty table | data:[] |
| 12 | GET /v1/posts/[id]/analytics | not published | 404 |
| 13 | GET /v1/content-history | platform filter | .eq filter |
| 14 | GET /v1/usage | no subscription | plan:null |

## End-to-End Test

Pending deployment.

## Decisions Made

- attach_media_from_url: Option B (REST orchestrates pure helpers directly)
- Catch-all routes: GET + DELETE combined in single [..path]/route.ts (Next.js limitation)
- Usage endpoint excludes Stripe internal fields, shows action counts without per-action caps
- DELETE returns { storage_path, deleted: boolean } (no references_remaining)
- analytics_metrics ships empty, populates when pipeline built

## Open Items

- analytics_metrics population (separate phase, pipeline needed)
- Drew tests media upload + view URL flow after deploy
- Drew tests usage endpoint after deploy

## Next Phase

Phase 5: Webhooks (HMAC-SHA256), tables webhook_subscriptions + webhook_deliveries

## Metrics

- Files created: 12
- Files modified: 0
- Lines added: ~910
- Commits: 1 (pending)
- Pause-and-ask interactions: 1 (Phase 0)
- Endpoints shipped: 8 (7 files, 8 handlers)
- Total v1 endpoints now: ~19
