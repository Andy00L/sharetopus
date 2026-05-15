# REST API Phase 5 Report -- Webhooks

**Branch:** main (direct commit)
**Commit:** pending
**Build state:** green (tsc --noEmit + npm run build)
**Generated:** 2026-05-15

## Summary

Phase 5 adds a complete webhooks subsystem: 7 REST endpoints for CRUD + test + delivery log, an Inngest delivery worker with HMAC-SHA256 signing and auto-disable on 10 consecutive failures, a single-source dispatcher called from 5 hook points in existing code (post scheduled/published/failed, connection connected/expired), and 2 new DB tables (webhook_subscriptions, webhook_deliveries).

## Files Created

| File | Lines | Purpose |
|---|---|---|
| src/lib/api/rest/webhooks/signWebhookPayload.ts | 15 | HMAC-SHA256 signer (single source) |
| src/lib/api/rest/webhooks/secretGenerator.ts | 11 | whsec_ prefix + 32 hex bytes |
| src/lib/api/rest/webhooks/eventTypes.ts | 18 | Canonical event type list + Zod enum |
| src/lib/api/rest/webhooks/verifyWebhookConfig.ts | 60 | URL validation (HTTPS, no private IPs) |
| src/lib/api/rest/webhooks/dispatch.ts | 65 | dispatchWebhook() (single source, fire-and-forget) |
| src/lib/api/rest/dto/toWebhookSubscriptionDTO.ts | 35 | DTO (strips secret) |
| src/lib/api/rest/dto/toWebhookDeliveryDTO.ts | 28 | DTO for delivery log entries |
| src/lib/api/rest/validation/webhookSchemas.ts | 55 | Zod schemas for all webhook endpoints |
| src/inngest/functions/deliverWebhook.ts | 140 | Inngest worker: deliver + retry + auto-disable |
| src/app/api/v1/webhooks/route.ts | 105 | POST create + GET list |
| src/app/api/v1/webhooks/[id]/route.ts | 190 | GET single + PATCH + DELETE |
| src/app/api/v1/webhooks/[id]/test/route.ts | 130 | POST synchronous test delivery |
| src/app/api/v1/webhooks/[id]/deliveries/route.ts | 90 | GET delivery log (paginated) |

## Files Modified

| File | Change | Reason | Risk |
|---|---|---|---|
| src/lib/types/database.types.ts | Added webhook_subscriptions + webhook_deliveries table types | New tables | Low |
| src/app/api/inngest/route.ts | Import + register deliverWebhook | Wire new worker | Low |
| src/actions/server/scheduleActions/schedule/schedulePostBatch.ts | Import dispatch + 1 call after insert | post.scheduled hook | Low |
| src/inngest/functions/processSinglePostHelpers.ts | Import dispatch + 3 calls in recordPostStatus | post.published, post.failed, connection.expired hooks | Low |
| src/lib/x402/oauth/callback/handleOAuthCallback.ts | Import dispatch + 1 call after connection success | connection.connected hook | Low |

## SQL Applied (by Drew)

- webhook_subscriptions table (uuid PK, principal FK, events array, secret, auto-disable fields)
- webhook_deliveries table (uuid PK, subscription FK, payload jsonb, delivery tracking)
- 4 indexes (principal+active, events GIN, subscription+created_at, event_id)
- RLS enabled on both tables

## Dispatcher Hook Points

| File | Event dispatched | Trigger point |
|---|---|---|
| schedulePostBatch.ts | post.scheduled | After successful upsert, before return |
| processSinglePostHelpers.ts | post.published | After status update to "posted" succeeds |
| processSinglePostHelpers.ts | post.failed | After terminal status update to "failed" |
| processSinglePostHelpers.ts | connection.expired | Alongside post.failed when reason is auth_expired |
| handleOAuthCallback.ts | connection.connected | After social_accounts UPSERT + social_connections UPDATE |

## response_summary Enrichment

| Endpoint | Audit summary keys |
|---|---|
| POST /v1/webhooks | subscription_id, events_count |
| GET /v1/webhooks | count, active_count |
| GET /v1/webhooks/[id] | subscription_id, failure_count |
| PATCH /v1/webhooks/[id] | subscription_id, fields_changed |
| DELETE /v1/webhooks/[id] | subscription_id, deliveries_deleted |
| POST /v1/webhooks/[id]/test | subscription_id, delivery_id, status_code, latency_ms |
| GET /v1/webhooks/[id]/deliveries | subscription_id, count |

## Invariant Verification

| # | Check | Result |
|---|---|---|
| I1 | Endpoint files exist | PASS (4 files) |
| I2 | Dispatcher single source | PASS |
| I3 | HMAC signer single source | PASS |
| I4 | 5 hook dispatch points | PASS (5 calls in 3 files) |
| I5 | HOF reused on all routes | PASS |
| I6 | No throws in handlers (1 in worker) | PASS |
| I7 | No any | PASS |
| I8 | No em-dash | PASS |
| I9 | auditSummary on all handlers | PASS |
| I10 | Secret not in GET DTO | PASS |
| I11 | Build clean | PASS |
| I12 | MCP regression | PASS |
| I13 | No migration files | PASS |
| I14 | deliverWebhook registered | PASS |
| I15 | Event name consistent | PASS |

## Decisions Made

- HMAC: SHA-256 hex (matches Stripe/GitHub convention)
- Auto-disable threshold: 10 consecutive failures
- Test endpoint: synchronous delivery (not via Inngest) for instant feedback
- Inngest worker: 2-arg createFunction with triggers in config (matches codebase pattern)
- URL validation: reuses isPrivateOrReservedIp from safeUserFetch
- Re-enabling a subscription resets failure_count to 0
- connection.expired dispatched alongside post.failed when reason is auth_expired

## Open Items

- Drew must run webhook SQL in Supabase before deploy
- Replay endpoint (Phase 6)
- Email notification on auto-disable (Phase 6)
- End-to-end curl tests pending deployment

## Next Phase

Phase 6: OpenAPI spec + Scalar docs + replay endpoint + auto-disable notifications

## Metrics

- Files created: 13
- Files modified: 5
- Lines added: ~950
- Commits: 1 (pending)
- Pause-and-ask interactions: 1 (Phase 0 - tables missing)
- Endpoints shipped: 7 (4 route files, 7 handlers)
- Inngest functions added: 1 (deliverWebhook)
- Hook points wired: 5
- Total v1 endpoints now: ~26
