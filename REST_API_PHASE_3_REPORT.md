# REST API Phase 3 Report -- Mutations + Connections + Bulk

**Branch:** main (direct commit)
**Commit:** pending
**Build state:** green (tsc --noEmit + npm run build)
**Generated:** 2026-05-15

## Summary

Phase 3 adds 8 new REST endpoints (PATCH/DELETE posts, bulk scheduling, connections suite) plus enriched audit logging across all v1 handlers. The OAuth callback route was moved from `/api/x402/oauth/callback/[platform]` to the shared `/api/oauth/callback/[platform]` path for use by both x402 and REST-initiated OAuth flows. All 8 shim callers of the deprecated `mcp/context.ts` re-exports were migrated to `@/lib/api/context`, and the shim was removed.

## Files Created

| File | Lines | Purpose |
|---|---|---|
| src/lib/api/rest/validation/postPatchSchemas.ts | 54 | Zod schemas for PATCH body, bulk input, DELETE query |
| src/lib/api/rest/validation/connectionSchemas.ts | 69 | Zod schemas for connection initiate, list query, boards query |
| src/lib/api/rest/dto/toConnectionDTO.ts | 41 | Maps social_accounts row to ConnectionDTO (tokens stripped) |
| src/lib/api/rest/dto/toPinterestBoardDTO.ts | 31 | Maps Pinterest board to PinterestBoardDTO |
| src/app/api/v1/posts/bulk/route.ts | 108 | POST /v1/posts/bulk |
| src/app/api/v1/connections/route.ts | 81 | GET /v1/connections |
| src/app/api/v1/connections/[id]/route.ts | 66 | GET /v1/connections/[id] |
| src/app/api/v1/connections/initiate/route.ts | 115 | POST /v1/connections/initiate |
| src/app/api/v1/connections/[id]/reauth/route.ts | 125 | POST /v1/connections/[id]/reauth |
| src/app/api/v1/connections/[id]/boards/route.ts | 148 | GET /v1/connections/[id]/boards |
| src/app/api/oauth/callback/[platform]/route.ts | 145 | Moved from x402 path, shared callback for x402+REST OAuth |

## Files Modified

| File | Change | Reason | Risk |
|---|---|---|---|
| src/lib/api/rest/middleware/withRestEndpoint.ts | Added RestHandlerResult union, dispatch on instanceof | Enriched audit summary support | Low (backward compat) |
| src/app/api/v1/posts/route.ts | POST + GET return enriched audit summaries | Phase 2 retrofit | Low |
| src/app/api/v1/posts/[id]/route.ts | GET returns enriched summary, added PATCH + DELETE handlers | Features + summary | Medium |
| src/lib/mcp/context.ts | Removed deprecated extractIpHash/extractUserAgent re-exports | Dead code cleanup | Low |
| src/lib/mcp/withMcpTool.ts | Split imports: shared from @/lib/api/context, MCP-specific from ./context | Shim migration | Low |
| src/lib/api/rest/auth/resolveRestApiKey.ts | Import from @/lib/api/context | Shim migration | Low |
| src/lib/mcp/auth/resolvers/apiKey.ts | Import from @/lib/api/context | Shim migration | Low |
| src/lib/mcp/auth/oauthClientTrust.ts | Dynamic import from @/lib/api/context | Shim migration | Low |
| src/app/api/x402/register/route.ts | Import from @/lib/api/context | Shim migration | Low |
| src/app/api/x402/oauth/status/route.ts | Import from @/lib/api/context | Shim migration | Low |
| src/app/api/x402/connect/route.ts | Import from @/lib/api/context | Shim migration | Low |

## Files Deleted

| File | Reason |
|---|---|
| src/app/api/x402/oauth/callback/[platform]/route.ts | Moved to src/app/api/oauth/callback/[platform]/route.ts |

## Reuse of Existing Functions

| Endpoint | Reused function | Source |
|---|---|---|
| PATCH /v1/posts/[id] | updateScheduledTimeBatch | src/actions/server/scheduleActions/reschedule/ |
| DELETE /v1/posts/[id] | cancelScheduledPostBatch, deleteScheduledPostBatch | src/actions/server/scheduleActions/cancel/, delete/ |
| POST /v1/posts/bulk | schedulePostBatch | src/actions/server/scheduleActions/schedule/ |
| POST /v1/posts/bulk | restInputToSchedulePostData | src/lib/api/rest/adapters/ |
| GET /v1/connections | adminSupabase (direct query, same as MCP) | -- |
| GET /v1/connections/[id] | adminSupabase (direct query, same as MCP) | -- |
| POST /v1/connections/initiate | buildOAuthUrl, generateOAuthState | src/lib/x402/connect/, src/lib/x402/oauth/ |
| POST /v1/connections/[id]/reauth | buildOAuthUrl, generateOAuthState | src/lib/x402/connect/, src/lib/x402/oauth/ |
| GET /v1/connections/[id]/boards | ensureValidToken, getPinterestBoards | src/lib/api/ensureValidToken, src/lib/api/pinterest/ |

## response_summary Enrichment

| Endpoint | Audit summary keys |
|---|---|
| POST /v1/posts | post_id, scheduled, platform, batch_id |
| GET /v1/posts | count, has_more |
| GET /v1/posts/[id] | post_id, status |
| PATCH /v1/posts/[id] | post_id, new_scheduled_at |
| DELETE /v1/posts/[id] | post_id, action |
| POST /v1/posts/bulk | batch_id, total, inserted, duplicates, rejected_count |
| GET /v1/connections | count |
| GET /v1/connections/[id] | connection_id, platform |
| POST /v1/connections/initiate | platform, connection_id |
| POST /v1/connections/[id]/reauth | connection_id, platform |
| GET /v1/connections/[id]/boards | connection_id, board_count |

## Shim Migration (mcp/context.ts)

| File | Old import | New import | Status |
|---|---|---|---|
| src/lib/api/rest/auth/resolveRestApiKey.ts | @/lib/mcp/context | @/lib/api/context | Done |
| src/lib/mcp/auth/resolvers/apiKey.ts | @/lib/mcp/context | @/lib/api/context | Done |
| src/lib/mcp/withMcpTool.ts | ./context (all 7) | @/lib/api/context (2 shared) + ./context (5 MCP-only) | Done |
| src/lib/mcp/auth/oauthClientTrust.ts | @/lib/mcp/context (dynamic) | @/lib/api/context (dynamic) | Done |
| src/app/api/x402/register/route.ts | @/lib/mcp/context | @/lib/api/context | Done |
| src/app/api/x402/oauth/status/route.ts | @/lib/mcp/context | @/lib/api/context | Done |
| src/app/api/x402/connect/route.ts | @/lib/mcp/context | @/lib/api/context | Done |
| src/app/api/x402/oauth/callback/[platform] | @/lib/mcp/context | @/lib/api/context (in new location) | Done (file moved) |

## OAuth Initiate Path Chosen

Option 2: REST creates a social_connections row with `initiated_via='api'` and returns the OAuth URL directly. Reuses existing `buildOAuthUrl()` from `src/lib/x402/connect/buildOAuthUrl.ts` (pure function) and `generateOAuthState()` from `src/lib/x402/oauth/state.ts`. The callback flow works via `handleOAuthCallback` which looks up social_connections by `oauth_state`.

## OAuth Callback Route Moved

`/api/x402/oauth/callback/[platform]` moved to `/api/oauth/callback/[platform]`. This route is now shared by x402 and REST-initiated OAuth flows. Drew must update OAuth provider redirect URIs (LinkedIn, TikTok, Pinterest, Instagram) in their dashboards and the `X402_*_REDIRECT_URI` env vars.

## Dead Code Removed

| File | What | Why |
|---|---|---|
| src/lib/mcp/context.ts | Deprecated re-exports of extractIpHash, extractUserAgent | All 8 callers migrated to @/lib/api/context |
| src/app/api/x402/oauth/callback/[platform]/route.ts | Entire file | Moved to /api/oauth/callback/[platform] |

## Invariant Verification

| # | Check | Result |
|---|---|---|
| I1 | New endpoint files exist | PASS (6 files) |
| I2 | PATCH + DELETE in posts/[id] | PASS (2 exports) |
| I3 | Bulk uses schedulePostBatch | PASS |
| I4 | Mutation handlers call batch functions | PASS |
| I7 | No throws in v1 handlers | PASS (0 hits) |
| I8 | No any / as unknown as | PASS (0 hits) |
| I9 | No em-dash | PASS (0 hits) |
| I10 | Shim removed | PASS (0 callers remain) |
| I11 | auditSummary on every handler | PASS (all files) |
| I12 | Build clean | PASS (tsc + npm run build) |
| I13 | MCP audit regression | PASS (mcp_audit_log still used) |
| I15 | No migration files | PASS |

## Edge Cases Handled

| # | Endpoint | Edge case | Handling | File:area |
|---|---|---|---|---|
| 1 | PATCH /v1/posts/[id] | ID not owned | 404 | posts/[id]/route.ts:PATCH ownership check |
| 2 | PATCH /v1/posts/[id] | scheduled_at in past | 400 via Zod refine | postPatchSchemas.ts |
| 3 | PATCH /v1/posts/[id] | Post in posted status | Skipped by updateScheduledTimeBatch (failed count) | Delegated to batch |
| 4 | DELETE /v1/posts/[id] | ID not owned | 404 | posts/[id]/route.ts:DELETE ownership check |
| 5 | DELETE /v1/posts/[id] | Post in processing status | Skipped by cancelScheduledPostBatch (succeeded=0) | Delegated to batch |
| 6 | DELETE ?hard=true | Media cleanup | deleteScheduledPostBatch handles cleanup | Delegated to batch |
| 7 | POST /v1/posts/bulk | Empty array | 400 via Zod .min(1) | postPatchSchemas.ts |
| 8 | POST /v1/posts/bulk | 31 posts | 400 via Zod .max(30) | postPatchSchemas.ts |
| 9 | POST /v1/posts/bulk | Any item invalid | 400 whole request rejected | Zod array validation |
| 11 | GET /v1/connections | No accounts | 200 with data:[] | connections/route.ts |
| 12 | GET /v1/connections | Platform filter | Supabase .eq filter | connections/route.ts |
| 13 | GET /v1/connections/[id] | Not owned | 404 | connections/[id]/route.ts |
| 14 | POST /v1/connections/initiate | Invalid platform | 400 via Zod enum | connectionSchemas.ts |
| 15 | POST /v1/connections/[id]/reauth | Not owned | 404 | reauth/route.ts |
| 16 | GET /v1/connections/[id]/boards | Not Pinterest | 400 | boards/route.ts platform check |
| 17 | GET /v1/connections/[id]/boards | Token expired | 401 with reauth_url | boards/route.ts ensureValidToken |

## End-to-End Test

Pending deployment. Curl tests will run on prod after commit + push.

## Decisions Made

- response_summary: Path A (RestHandlerResult union) -- backward compatible, clean
- OAuth initiate: Option 2 (create social_connections row with initiated_via='api')
- OAuth reauth: Real OAuth URL via buildOAuthUrl (not MCP-style /connections page)
- OAuth callback: Moved to shared /api/oauth/callback/[platform] (Drew updates provider dashboards)
- Hard delete: ?hard=true query param on DELETE
- Soft cancel: Returns 200 with details (succeeded/failed counts), not 409
- Bulk rejected: Native shape { socialAccountId, reason } from schedulePostBatch
- Shim removal: All 8 callers migrated (7 found in Phase 0 + 1 dynamic import found during build)
- social_connections.id: Required by Supabase types, generated via crypto.randomUUID()

## Open Items

- Drew must update OAuth provider redirect URIs from /api/x402/oauth/callback/* to /api/oauth/callback/*
- Drew must update X402_*_REDIRECT_URI env vars to point to new callback path
- End-to-end curl tests pending deployment

## Next Phase

Phase 4: media upload signed URL, analytics endpoints

## Metrics

- Files created: 11
- Files modified: 11
- Files deleted: 1
- Lines added/removed: ~1100/210
- Commits: 1 (pending)
- Pause-and-ask interactions: 1 (Phase 0)
- Endpoints shipped: 8
- Endpoints updated (Phase 2 retrofit): 3
- Shim callers migrated: 8
