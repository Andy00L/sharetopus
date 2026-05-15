# REST API Phase 2 Report -- Core endpoints + HOF + UI

**Branch:** main (direct commit)
**Commit:** pending
**Build state:** green (tsc --noEmit + npm run build)
**Generated:** 2026-05-15

## Summary

Phase 2 wires the first REST endpoints end-to-end. A developer can now
create a REST API key via the Integrations UI and call `POST /v1/posts`,
`GET /v1/posts`, and `GET /v1/posts/[id]` with Bearer auth. The HOF
(`withRestEndpoint`) handles auth resolution, scope checks, rate limiting,
and audit logging. Shared helpers (`extractIpHash`, `extractUserAgent`,
`redactSecrets`, `REDACT_KEYS`) were extracted to shared locations so
both MCP and REST import from a single source. MCP behavior is unchanged.

## Files Created

| File | Lines | Purpose |
|---|---|---|
| `src/lib/api/context.ts` | 37 | Shared extractIpHash + extractUserAgent |
| `src/lib/api/audit/redactPatterns.ts` | 63 | Shared REDACT_KEYS, redactSecrets, looksLikeJwt, truncateJson |
| `src/lib/api/rest/errors/restErrorResponse.ts` | 46 | Standard REST error response factory |
| `src/lib/api/rest/audit/writeRestAuditLog.ts` | 81 | Insert helper for rest_audit_log |
| `src/lib/api/rest/validation/schemas.ts` | 104 | Zod schemas (PostCreateInput, PostListQuery) |
| `src/lib/api/rest/dto/toPostDTO.ts` | 44 | Public DTO mapper |
| `src/lib/api/rest/adapters/restInputToScheduledPost.ts` | 65 | Pure mappers: restInputToSchedulePostData + restInputToDirectPostData |
| `src/lib/api/rest/middleware/withRestEndpoint.ts` | 196 | HOF (no generics) |
| `src/app/api/v1/posts/route.ts` | 198 | POST + GET list |
| `src/app/api/v1/posts/[id]/route.ts` | 64 | GET single |
| `src/actions/server/api/createRestApiKey.ts` | 98 | Server action: create REST key |
| `src/actions/server/api/revokeRestApiKey.ts` | 66 | Server action: revoke REST key |
| `src/actions/server/api/listRestApiKeys.ts` | 59 | Server action: list REST keys |
| `src/app/(protected)/integrations/components/RestApiKeysCard.tsx` | 231 | UI card for REST keys |

## Files Modified

| File | Change | Reason | Risk |
|---|---|---|---|
| `src/lib/mcp/context.ts` | Replaced extractIpHash + extractUserAgent with re-export shim | Single source of truth | Low: shim is transparent to callers |
| `src/lib/mcp/audit.ts` | Removed inline REDACT_KEYS/redactSecrets/looksLikeJwt/truncateJson; imports from shared | Single source of truth | Low: functions moved verbatim |
| `src/lib/types/database.types.ts` | Added rest_audit_log table type (Row/Insert/Update) + RestAuditLog alias | Drew ran SQL manually, types added to match | Low: additive |
| `src/app/(protected)/integrations/page.tsx` | Added listRestApiKeys import, RestApiKeysCard mount, parallel fetch | Mount REST keys UI section | Low: additive |

## Source-of-Truth Extractions

| Item | Old location | New shared location | Importers updated |
|---|---|---|---|
| extractIpHash | src/lib/mcp/context.ts | src/lib/api/context.ts | mcp/context.ts re-exports (shim) |
| extractUserAgent | src/lib/mcp/context.ts | src/lib/api/context.ts | mcp/context.ts re-exports (shim) |
| REDACT_KEYS | src/lib/mcp/audit.ts | src/lib/api/audit/redactPatterns.ts | mcp/audit.ts imports |
| redactSecrets | src/lib/mcp/audit.ts | src/lib/api/audit/redactPatterns.ts | mcp/audit.ts imports |
| looksLikeJwt | src/lib/mcp/audit.ts | src/lib/api/audit/redactPatterns.ts | mcp/audit.ts imports |
| truncateJson | src/lib/mcp/audit.ts | src/lib/api/audit/redactPatterns.ts | mcp/audit.ts imports |

## Callers of extractIpHash (preserved by shim)

| File | Import path |
|---|---|
| src/lib/mcp/withMcpTool.ts | ./context |
| src/lib/mcp/auth/resolvers/apiKey.ts | @/lib/mcp/context |
| src/lib/mcp/auth/oauthClientTrust.ts | dynamic import @/lib/mcp/context |
| src/lib/api/rest/auth/resolveRestApiKey.ts | @/lib/mcp/context |
| src/app/api/x402/register/route.ts | @/lib/mcp/context |
| src/app/api/x402/oauth/status/route.ts | @/lib/mcp/context |
| src/app/api/x402/oauth/callback/[platform]/route.ts | @/lib/mcp/context |
| src/app/api/x402/connect/route.ts | @/lib/mcp/context |

## Per-platform option fields actually wired

| Platform | Field | Worker file that reads it |
|---|---|---|
| Pinterest | pinterest_board_id | schedulePostBatch (via postOptions.board), directPostBatch (via pinterestBoardId) |
| Pinterest | pinterest_board_name | schedulePostBatch (via postOptions.boardName), directPostBatch (via pinterestBoardName) |
| Pinterest | pinterest_link | schedulePostBatch (via postOptions.link), directPostBatch (via pinterestLink) |

TikTok, Instagram, LinkedIn option fields exist in SchedulePostData.postOptions but are not exposed in the MCP schedulePost tool and are not added to the REST API in Phase 2.

## Dead Code Removed

| File | What | Why |
|---|---|---|
| src/lib/mcp/context.ts | extractIpHash implementation (20 lines) | Moved to src/lib/api/context.ts |
| src/lib/mcp/context.ts | extractUserAgent implementation (8 lines) | Moved to src/lib/api/context.ts |
| src/lib/mcp/context.ts | hashClientIp import | No longer needed in this file |
| src/lib/mcp/context.ts | headers import | No longer needed in this file |
| src/lib/mcp/audit.ts | REDACT_KEYS constant | Moved to redactPatterns.ts |
| src/lib/mcp/audit.ts | MAX_ARGS_LENGTH constant | Moved to redactPatterns.ts |
| src/lib/mcp/audit.ts | redactSecrets function | Moved to redactPatterns.ts |
| src/lib/mcp/audit.ts | looksLikeJwt function | Moved to redactPatterns.ts |
| src/lib/mcp/audit.ts | truncateJson function | Moved to redactPatterns.ts |

## Invariant Verification

| # | Check | Result |
|---|---|---|
| I1 | New files exist | PASS |
| I2 | extractIpHash ONE implementation | PASS (src/lib/api/context.ts only) |
| I3 | REDACT_KEYS ONE definition | PASS (src/lib/api/audit/redactPatterns.ts only) |
| I4 | mcp/audit.ts imports redactSecrets from shared | PASS |
| I5 | HOF reuses all 4 helpers (no re-implementation) | PASS |
| I6 | No throws in route handlers | PASS (0 hits) |
| I7 | No any / as unknown as | PASS (0 hits in rest/ and v1/) |
| I8 | No em-dash | PASS |
| I9 | No generics on withRestEndpoint | PASS |
| I10 | All v1 routes go through HOF | PASS (3 exports, all withRestEndpoint) |
| I11 | No migration file | PASS |
| I12 | Build clean (tsc + next build) | PASS |
| I13 | MCP logToolCall still inserts to mcp_audit_log | PASS |

## Edge Cases Handled

| # | Edge case | Handler | File:line |
|---|---|---|---|
| 1 | Missing Authorization | 401, no audit row | withRestEndpoint.ts:72-79 |
| 2 | Wrong scheme (not Bearer) | 401, no audit row | withRestEndpoint.ts:72-79 |
| 3 | Valid format unknown token | 401, no audit row | withRestEndpoint.ts:82-88 |
| 4 | Expired key | 401 (Phase 1 resolver) | resolveRestApiKey.ts |
| 5 | Missing body on POST | 400 validation_error | posts/route.ts:36-47 |
| 6 | Body is not JSON | 400 validation_error with parse_error | posts/route.ts:36-47 |
| 7 | Body fails Zod | 400 validation_error with issues | posts/route.ts:50-58 |
| 8 | Rate limit hit | 429, audit outcome=rate_limited | withRestEndpoint.ts:123-142 |
| 9 | Handler throws | 500 internal_error, audit row written | withRestEndpoint.ts:145-167 |
| 10 | DB list query error | 500 internal_error | posts/route.ts:186-195 |
| 11 | GET /v1/posts/[id] id not owned | 404 not_found | posts/[id]/route.ts:43-49 |
| 12 | scheduled_at in past | 400 validation_error | schemas.ts:72-80 |
| 13 | platform=pinterest no board_id | 400 validation_error | schemas.ts:45-51 |
| 14 | post_type=text non-LinkedIn | 400 validation_error | schemas.ts:53-59 |
| 15 | Audit log INSERT fails | warning logged, request succeeds | writeRestAuditLog.ts:69-74 |
| 16 | MCP schedule_post still fires its audit | Regression: yes (no MCP path change) | mcp/audit.ts:87 |

## End-to-End Test

Requires Vercel preview deployment. Drew to run:

```bash
curl -X POST https://<preview-url>/api/v1/posts \
  -H "Authorization: Bearer stp_rest_..." \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "linkedin",
    "post_type": "text",
    "description": "Phase 2 REST test post",
    "scheduled_at": "2026-05-17T15:00:00Z",
    "social_account_id": "<real-uuid>"
  }'
```

## Decisions Made

- HOF design: no generics, handler does own Zod parsing
- Platform fields: flat (mirror MCP), Pinterest only
- redactSecrets extraction: REDACT_KEYS + redactSecrets + looksLikeJwt + truncateJson moved to shared
- ApiKeysCard reuse: Path B (sibling RestApiKeysCard.tsx)
- Two adapters: restInputToSchedulePostData (scheduled) + restInputToDirectPostData (immediate)
- Direct post DTO lookup: query scheduled_posts by batch_id + principal_id after dispatch
- Rate limit return shape: uses success/resetIn (matches checkRateLimit actual signature)
- Migration: no file; SQL run manually by Drew, types added manually
- revokeApiKey: separate revokeRestApiKey (kind='rest' filter)
- Double rate limit: HOF rate limit + batch function internal rate limit, documented, no fix

## Open Items

- Shim callers of mcp/context.ts still import from old path (working via re-export)
- Other MCP context helpers (extractPrincipal etc.) not moved
- rest_audit_log SQL table creation was done manually by Drew; types added manually here
- End-to-end curl test pending Vercel preview deployment

## Next Phase

Phase 3:
- PATCH /v1/posts/[id] (update scheduled_at, cancel)
- DELETE /v1/posts/[id]
- POST /v1/posts/bulk
- GET /v1/connections (list connected social accounts)
- response_summary enrichment in audit log
- Migrate shim callers to direct @/lib/api/context imports

## Metrics

- Files created: 14
- Files modified: 4
- Lines added: ~1300
- Lines removed: ~83
- Commits: 1
- Pause-and-ask interactions: 1
