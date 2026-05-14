# API Key Expiration + IP Tracking Fix Report

**Branch:** main (direct commit)
**Build state:** green (tsc + next build)
**Generated:** 2026-05-14

## Summary

Added user-selectable expiry durations (7, 30, 90, 365 days) when creating MCP API keys. New keys now INSERT with `expires_at` set. The UI shows a duration dropdown, a security warning for 1-year keys, and color-coded expiry status on existing keys. Shared constants file ensures client and server validate against the same allow-list. The resolver already had expiry checking and `last_used_ip` tracking via `extractIpHash()`, so no resolver changes were needed.

## Scope (Updated)

Phases 4, 5, 6 were skipped per Drew's direction. `resolveApiKey.ts` already had expiry check (line 44), `last_used_at` + `last_used_ip` UPDATE (lines 74-90), and IP sourcing via `extractIpHash()`. No resolver refactor needed.

**In scope:**
- New `src/lib/mcp/apiKeyExpiry.ts` (shared constants)
- `ApiKeysCard.tsx` UI changes (dropdown, warning, expiry display, slice hack removal)
- `createApiKey.ts` signature extension (expiresInDays param, expires_at INSERT, prefix + expiresAtIso return)

**Out of scope (unchanged from original):**
- SQL migration (already applied by Drew)
- ResolveHints extension (resolver already handles IP independently)
- route.ts hints threading (not needed)
- resolveApiKey.ts changes (already complete)
- 401 audit log on expired keys (separate ticket)
- Notification cron 7d before expiry
- Auto-rotation

## Files Modified

| File | Change | Risk |
|---|---|---|
| `src/lib/mcp/apiKeyExpiry.ts` | NEW. Shared expiry constants + type guard | Low (pure types + validation) |
| `src/actions/server/mcp/createApiKey.ts` | Added `expiresInDays` param, validation, `expires_at` in INSERT, `prefix` + `expiresAtIso` in return | Low (additive, single caller) |
| `src/app/(protected)/integrations/components/ApiKeysCard.tsx` | Expiry dropdown, 365d warning, color-coded expiry display, removed slice hack | Low (UI only) |

## Investigation Set (Phase 0)

| File | Lines | Functions / exports | Notes |
|---|---|---|---|
| `database.types.ts` | 1966+ | `ApiKey` type | `expires_at`, `last_used_at`, `last_used_ip` on Row/Insert/Update |
| `ipHash.ts` | 77 | `hashClientIp()` | Not modified. SHA-256 + salt. |
| `resolve.ts` | 84 | `resolveMcpPrincipal()` | Not modified. Calls resolveApiKey without hints. |
| `oauth.ts` | 113 | `ResolveHints`, `verifyOAuthToken()`, `assertOAuthClientTrust()` | Not modified. |
| `apiKey.ts` (resolver) | 100 | `resolveApiKey(rawToken)` | Already has expiry check + last_used_ip UPDATE. Not modified. |
| `types.ts` (auth) | 36 | `McpPrincipal` union | Not modified. |
| `tokens.ts` | 47 | `generateMcpApiKey()`, `hashToken()`, `isMcpApiKeyToken()` | Not modified. Returns `{ rawKey, prefix, tokenHash }`. |
| `route.ts` | 257 | `authHandler` | Not modified. |
| `createApiKey.ts` | 117 | `createApiKey()` | Modified: +expiresInDays, +expires_at, +prefix/expiresAtIso return |
| `listApiKeys.ts` | 59 | `listApiKeys()` | Not modified. Already SELECTs expires_at. |
| `revokeApiKey.ts` | 67 | `revokeApiKey()` | Not modified. |
| `ApiKeysCard.tsx` | 196 | `ApiKeysCard()` | Modified: dropdown, warning, expiry display, removed slice hack |
| `McpDocsCard.tsx` | 108 | `McpDocsCard()` | Not modified. |
| `page.tsx` (integrations) | 51 | `IntegrationsPage()` | Not modified. |
| `authCheck.ts` | 31 | `authCheck()` | Not modified. |
| `checkRateLimit.ts` | 116 | `checkRateLimit()` | Not modified. |
| `checkActiveSubscription.ts` | 78 | `checkActiveSubscription()` | Not modified. |
| `context.ts` | 119 | `extractIpHash()` etc. | Not modified. Used by resolveApiKey.ts for IP hashing. |

## Architecture

```
UI (ApiKeysCard.tsx)
  |
  | createApiKey(userId, name, expiresInDays)
  v
createApiKey.ts
  |-- validates expiresInDays via isValidApiKeyExpiryDays (shared constants)
  |-- computes apiKeyExpiresAtIso = now + expiresInDays
  |-- INSERT into api_keys with expires_at
  |-- returns { rawKey, keyId, prefix, expiresAtIso }
  v
UI displays prefix (no more slice hack) + color-coded expiry

Auth path (unchanged):
  route.ts -> resolveMcpPrincipal -> resolveApiKey
    |-- SELECT api_keys row
    |-- if expires_at < now -> return null (reject)
    |-- waitUntil: UPDATE last_used_at + last_used_ip (via extractIpHash)
    |-- return McpPrincipal
```

## Invariant Verification

| # | Check | Result |
|---|---|---|
| I1 | Shared constants in definition + createApiKey + ApiKeysCard | PASS (1 def + 2 callsites) |
| I2 | No client-side prefix slice hack | PASS (0 matches in src/app/) |
| I5 | expires_at checked in resolveApiKey.ts | PASS (line 44) |
| I6 | No em-dash in modified files | PASS |
| I7 | No `any` in modified files | PASS |
| I8 | No throws in createApiKey.ts | PASS |
| I9 | Build clean (tsc + next build) | PASS |

## Edge Cases Handled

| # | Edge case | Behavior | Location |
|---|---|---|---|
| 1 | User selects 365 days | Warning displayed, key created with 365d expiry | ApiKeysCard.tsx warning block |
| 2 | Tampered DOM submits non-whitelist value | Server rejects: "Invalid expiry duration..." | createApiKey.ts:70 |
| 3 | Existing key with expires_at = NULL | Auth passes (null check in resolver) | resolveApiKey.ts:44 |
| 4 | Key expired by 1 second | Auth fails closed (returns null) | resolveApiKey.ts:44-46 |
| 5 | 10-key cap | Unchanged: "Maximum 10 active MCP keys allowed" | createApiKey.ts:79 |
| 6 | UI renders key with expires_at: null (legacy) | No expiry label shown (conditional render) | ApiKeysCard.tsx |
| 7 | Key expiring in < 7 days | Red text | ApiKeysCard.tsx expiryColorClass |
| 8 | Key expiring in 7-30 days | Yellow/amber text | ApiKeysCard.tsx expiryColorClass |
| 9 | Key expiring in > 30 days | Green text | ApiKeysCard.tsx expiryColorClass |

## Decisions Made

- Shared constants in `src/lib/mcp/apiKeyExpiry.ts` (matches existing `ipHash.ts`, `tokens.ts` pattern). No `server-only` import so client can use it.
- Default expiry: 90 days, industry standard.
- 365-day option kept with explicit UI warning rather than blocked.
- Skipped Phases 4-6: resolver already has expiry check + IP tracking via extractIpHash(). No refactor needed.
- Prefix returned explicitly from createApiKey() to eliminate client-side slice hack.

## Open Items

- Notification cron (warn user 7d before expiry) not in scope.
- 401 audit log entry specifically for expired-key rejection (separate ticket).

## Metrics

- Files created: 2 (apiKeyExpiry.ts, this report)
- Files modified: 2 (createApiKey.ts, ApiKeysCard.tsx)
- Commits: 1
- Pause-and-ask interactions: 1 (Phase 0 report, Drew chose Option B)
