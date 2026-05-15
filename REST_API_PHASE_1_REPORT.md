# REST API Phase 1 Report -- Foundation (Auth + Types)

**Branch:** main (direct commit)
**Build state:** green (tsc + next build)
**Generated:** 2026-05-14

## Summary

Created the auth foundation for the REST API v1 surface. Extracted generic
token utilities from the MCP-specific implementation, converted the original
to a backward-compatible shim, defined the RestPrincipal type, and built the
REST API key resolver that reuses the shared subscription gate. Zero endpoints
exposed. MCP behavior unchanged.

## Files Created

| File | Lines | Purpose |
|---|---|---|
| `src/lib/types/principal.ts` | 15 | GatablePrincipal interface for shared subscription gate |
| `src/lib/api/tokens.ts` | 61 | Generic API key generation, hashing, and format detection |
| `src/lib/api/rest/auth/types.ts` | 32 | RestPrincipal + RestApiKeyContext type definitions |
| `src/lib/api/rest/auth/resolveRestApiKey.ts` | 125 | Bearer token resolver for REST API keys |

## Files Modified

| File | Change | Risk |
|---|---|---|
| `src/lib/mcp/tokens.ts` | Replaced with shim re-exporting from `@/lib/api/tokens` | Low (all 3 exports preserved, callers unchanged) |
| `src/lib/mcp/auth/resolvers/applySubscriptionGate.ts` | Widened param from `McpPrincipal` to generic `<T extends GatablePrincipal>` | Low (backward-compatible widening, existing callers infer McpPrincipal) |

## Investigation Set (Phase 0 proof)

| File | Purpose | Notes |
|---|---|---|
| `src/lib/types/database.types.ts` | Schema source of truth | kind: "rest"\|"mcp"\|"wallet" confirmed |
| `src/lib/mcp/tokens.ts` | Refactor source | 3 exports, no surprises |
| `src/lib/mcp/auth/resolvers/apiKey.ts` | Resolver template | Pattern mirrored in REST resolver |
| `src/lib/mcp/auth/resolve.ts` | Orchestrator pattern | Uses isMcpApiKeyToken + applySubscriptionGate |
| `src/lib/mcp/auth/types.ts` | McpPrincipal shape | Discriminated union, apikey\|oauth |
| `src/lib/mcp/auth/resolvers/applySubscriptionGate.ts` | Shared gate (reused) | Generified to accept GatablePrincipal |
| `src/lib/mcp/auth/resolvers/subscriptionCache.ts` | Cache layer | Unchanged, reused via gate |
| `src/lib/mcp/ipHash.ts` | IP hashing | Unchanged, reused via extractIpHash |
| `src/lib/mcp/context.ts` | extractIpHash helper | Unchanged, imported by REST resolver |
| `src/lib/types/plans.ts` | PlanTier type | Used by RestPrincipal and GatablePrincipal |
| `src/actions/api/adminSupabase.ts` | DB client | Used by REST resolver |
| `src/actions/server/mcp/createApiKey.ts` | Caller of generateMcpApiKey | Still uses shim, compiles clean |

## Callers of `src/lib/mcp/tokens.ts` (preserved by shim)

| File | Import |
|---|---|
| `src/actions/server/mcp/createApiKey.ts` | `generateMcpApiKey` |
| `src/lib/mcp/auth/resolve.ts` | `isMcpApiKeyToken` |
| `src/lib/mcp/auth/resolvers/apiKey.ts` | `hashToken` |

## Dead Code Removed

| File | What | Why |
|---|---|---|
| `src/lib/mcp/tokens.ts` | `import { randomBytes, createHash }` | No longer needed in shim (logic moved to api/tokens.ts) |

## Invariant Verification

| # | Check | Result |
|---|---|---|
| I1 | New files exist | PASS (4 files) |
| I2 | Shim exports all 3 names | PASS (generateMcpApiKey, isMcpApiKeyToken, hashToken) |
| I3 | Shim has @deprecated markers | PASS (3 hits) |
| I4 | No duplicate token-generation logic | PASS (randomBytes only in api/tokens.ts for key gen) |
| I5 | REST resolver reuses MCP helpers | PASS (1 import of applySubscriptionGate, no re-implementation) |
| I6 | No throws in REST resolver | PASS (0 hits) |
| I7 | No `any` in new files | PASS (0 hits) |
| I8 | No em-dash in modified files | PASS (0 hits) |
| I9 | Build clean | PASS (tsc + next build zero errors) |

## Edge Cases Handled

| # | Edge case | Behavior | Location |
|---|---|---|---|
| 1 | Token missing stp_rest_ prefix | isApiKeyToken returns false, resolver returns null | resolveRestApiKey.ts:43 |
| 2 | Valid format but no DB row | maybeSingle returns null, resolver returns null | resolveRestApiKey.ts:60 |
| 3 | Row exists but revoked | Filtered by .is("revoked_at", null), not returned | resolveRestApiKey.ts:51 |
| 4 | Row exists, expires_at in past | Step 3 returns null with warning log | resolveRestApiKey.ts:64-70 |
| 5 | Row exists, expires_at null (no expiry) | Step 3 passes through | resolveRestApiKey.ts:64 |
| 6 | No active subscription | applySubscriptionGate returns null | resolveRestApiKey.ts:88 |
| 7 | extractIpHash returns null | UPDATE proceeds without last_used_ip field | resolveRestApiKey.ts:112-113 |
| 8 | last_used UPDATE fails | Logged as warning, auth already succeeded | resolveRestApiKey.ts:118-121 |
| 9 | applySubscriptionGate throws | Outer try/catch returns null | resolveRestApiKey.ts:93-97 |
| 10 | Concurrent requests with same token | Each gets own RestPrincipal, no shared mutation | N/A (stateless) |

## Decisions Made

- Shim vs full migration: kept shim with @deprecated markers (callers migrate in separate ticket)
- RestPrincipal kind: literal "rest" (not union with future "wallet")
- Subscription gate reuse: generified with `<T extends GatablePrincipal>` instead of casting
- GatablePrincipal location: `src/lib/types/principal.ts` (shared between MCP and REST)
- last_used update: waitUntil fire-and-forget (matches MCP pattern)
- Prefix length: 16 hex chars after kind segment (longer than MCP's original 8, intentional for better UI distinguishability)

## Open Items (in code, NOT fixed in this commit)

- MCP resolver (`apiKey.ts`) does a secondary `principals` table lookup for defense-in-depth; REST resolver skips this (api_keys FK already enforces principal kind). Consider adding if needed.
- `extractIpHash` lives in `src/lib/mcp/context.ts`. If more REST code needs it, consider extracting to a shared location (e.g. `src/lib/api/context.ts`).
- The shim callers (3 files) should be migrated to import from `@/lib/api/tokens` directly in a follow-up ticket.

## Next Phase

Phase 2 builds:
- withRestEndpoint HOF (wraps route handlers with auth + context)
- Zod schemas for request/response validation
- POST /v1/posts + GET /v1/posts + GET /v1/posts/[id]
- rest_audit_log table
- "REST API Keys" UI section in integrations page

## Metrics

- Files created: 4
- Files modified: 2
- Commits: 1
- Pause-and-ask interactions: 1
