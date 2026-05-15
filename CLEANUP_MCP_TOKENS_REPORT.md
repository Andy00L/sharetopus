# Cleanup Report -- mcp/tokens.ts shim removal

**Branch:** main (direct commit)
**Commit:** pending
**Build state:** green (tsc --noEmit + npm run build)
**Generated:** 2026-05-15

## Summary

Removed src/lib/mcp/tokens.ts shim. All 3 callers now import directly from
src/lib/api/tokens. Zero behavior change.

## Files Deleted

| File | Lines |
|---|---|
| src/lib/mcp/tokens.ts | 28 |

## Files Modified

| File | Old import | New import | Calls adjusted |
|---|---|---|---|
| src/actions/server/mcp/createApiKey.ts | generateMcpApiKey from @/lib/mcp/tokens | generateApiKey from @/lib/api/tokens | generateMcpApiKey() -> generateApiKey("mcp") |
| src/lib/mcp/auth/resolve.ts | isMcpApiKeyToken from @/lib/mcp/tokens | isApiKeyToken from @/lib/api/tokens | isMcpApiKeyToken(t) -> isApiKeyToken(t, "mcp") |
| src/lib/mcp/auth/resolvers/apiKey.ts | hashToken from @/lib/mcp/tokens | hashToken from @/lib/api/tokens | None (same function name) |

## Invariant Verification

| # | Check | Result |
|---|---|---|
| I1 | Shim file deleted | PASS |
| I2 | No remaining import from old path | PASS |
| I3 | No remaining calls to shim wrapper names | PASS |
| I4 | All callers use @/lib/api/tokens | PASS |
| I5 | Build clean (tsc + npm run build) | PASS |
| I6 | MCP regression (manual) | Drew tests after deploy |

## Behavior Confirmation

- generateApiKey("mcp") produces stp_mcp_... prefix (unchanged from generateMcpApiKey)
- isApiKeyToken(t, "mcp") matches stp_mcp_... pattern (unchanged from isMcpApiKeyToken)
- hashToken(t) is the same function (was direct re-export)

## Open Items

- Drew tests MCP API key creation via integrations UI after deploy
- docs/AUTH.md references old function names (separate docs cleanup)

## Metrics

- Files deleted: 1
- Files modified: 3
- Lines removed: 28
- Commits: 1 (pending)
