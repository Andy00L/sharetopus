# Vuln 5 Report -- OAuth Client Trust Fail-Closed

**Branch:** main
**Build state:** clean (tsc --noEmit + npm run build)
**Generated:** 2026-05-15

## Summary

Flipped 3 fail-open returns in `checkOAuthClientTrust` to fail-closed.
DB errors (SELECT failure, unexpected exception, INSERT failure) now deny
access with `reason: "lookup_failed"` instead of silently allowing. The
empty clientId early-return path stays as fail-open per Drew's decision
(structural case, not a DB error). Updated the JSDoc and 2 inline comments
to reflect the fail-closed posture.

## Files Modified

| File | Change |
|---|---|
| src/lib/mcp/auth/oauthClientTrust.ts | 3 fail-open returns flipped to `{ allowed: false, reason: "lookup_failed" }`, JSDoc updated, 2 inline comments updated, 1 trailing comment removed |

## Behavior Change

| Scenario | Before | After |
|---|---|---|
| DB SELECT error (line 81) | `{ allowed: true }` | `{ allowed: false, reason: "lookup_failed" }` |
| Unexpected exception (line 114) | `{ allowed: true }` | `{ allowed: false, reason: "lookup_failed" }` |
| INSERT failure on first-sight (line 187) | `{ allowed: true }` | `{ allowed: false, reason: "lookup_failed" }` |
| Empty clientId (line 52) | `{ allowed: true }` | unchanged (Drew decision) |
| All success paths (lines 63, 105, 202) | `{ allowed: true }` | unchanged |

## Caller Impact

| Caller | How `lookup_failed` is handled | User-facing result |
|---|---|---|
| `assertOAuthClientTrust` (resolvers/oauth.ts:104) | Returns `false` | Logged as trust refusal |
| `resolveAuth` (resolve.ts:81) | Returns `null` when `!trustOk` | MCP route responds with 401 |

During a DB outage, MCP clients with cache misses receive 401 until DB recovers. Cached clients are unaffected.

## Invariant Verification

| # | Check | Result |
|---|---|---|
| I1 | `reason: "lookup_failed"` count = 3 | OK (3) |
| I2 | No "fail open" / "fail-open" comments | OK |
| I3 | JSDoc says "Fails CLOSED", no "Fails OPEN" | OK |
| I4 | Empty-clientId path still returns `{ allowed: true }` | OK |
| I5 | No `any` introduced | OK |
| I6 | No em-dash | OK |
| I7 | tsc --noEmit + npm run build clean | OK |
| I8 | `allowed: true` occurrences = 5 (1 type def + 4 returns) | OK (was 8: 1 type def + 7 returns; delta = 3) |

## Edge Case Audit

| # | Scenario | Expected behavior |
|---|---|---|
| 1 | DB SELECT fails transiently | Denied with `lookup_failed`, NOT cached, next request retries |
| 2 | Unexpected exception thrown | Denied with `lookup_failed` |
| 3 | INSERT fails on first-sight | Denied with `lookup_failed` (not cached; retry on next request) |
| 4 | Cache hit for verified client | Allowed (unchanged) |
| 5 | Cache hit for blocked client | Denied with `blocked` (unchanged) |
| 6 | Cache hit for revoked client | Denied with `revoked` (unchanged) |
| 7 | Empty `clientId` | Allowed (Drew decision: structural case) |
| 8 | Normal first-sight success | Allowed, cached as verified or unverified per slot count |
| 9 | DCR rate limit hit | Denied with `rate_limited` (unchanged) |
| 10 | Verified-count query fails | Falls through to unverified default (unchanged, not a fail-open) |

## Smoke Test Results

Pending Drew deploy.

## Risks / Open Items

- During a Supabase outage, ALL MCP OAuth clients with cache misses are denied 401 until DB recovers. This is the intended trade-off. Monitor `lookup_failed` rate post-deploy; a sustained spike indicates DB health issues, not a bug.
- The in-memory cache (per Vercel function instance) limits the blast radius. Already-cached clients continue working. New clients or cold function instances are affected.
- No caching strategy changes were made. Failed lookups are still not cached, so recovery is immediate once DB connectivity returns.

## Metrics

- Files modified: 1
- Returns flipped: 3
- Comments updated: 2 inline + 1 JSDoc + 1 trailing comment removed
- Lines changed: ~10
