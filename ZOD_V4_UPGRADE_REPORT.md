# Zod 4 Upgrade Report

**Branch:** main
**Commit:** pending
**Build state:** green (tsc --noEmit + npm run build)
**Generated:** 2026-05-15

## Summary

Migrated codebase from Zod 3.25.76 to Zod 4.4.3. Drew ran `npm install zod@latest`
beforehand. No codemod needed: the only breaking change was `z.string().uuid()` -> `z.guid()`
(14 occurrences across 14 files). All other Zod patterns (`.url()`, `.datetime()`,
`.coerce`, `.superRefine()`, `.safeParse()`) are backward-compatible in Zod 4.

## Codemod Output

- Codemod not used (surface area was 14 identical replacements, manual was faster and safer)
- Manual fixes: 14 files, one pattern each

## Files Modified

| File | Change | Manual touch |
|---|---|---|
| src/lib/api/rest/validation/schemas.ts | `z.string().uuid()` -> `z.guid()` | Yes |
| src/app/api/v1/posts/[id]/route.ts | `z.string().uuid()` -> `z.guid()` | Yes |
| src/app/api/v1/posts/[id]/analytics/route.ts | `z.string().uuid()` -> `z.guid()` | Yes |
| src/app/api/v1/connections/[id]/route.ts | `z.string().uuid()` -> `z.guid()` | Yes |
| src/app/api/v1/connections/[id]/boards/route.ts | `z.string().uuid()` -> `z.guid()` | Yes |
| src/app/api/v1/connections/[id]/reauth/route.ts | `z.string().uuid()` -> `z.guid()` | Yes |
| src/app/api/v1/webhooks/[id]/route.ts | `z.string().uuid()` -> `z.guid()` | Yes |
| src/app/api/v1/webhooks/[id]/test/route.ts | `z.string().uuid()` -> `z.guid()` | Yes |
| src/app/api/v1/webhooks/[id]/deliveries/route.ts | `z.string().uuid()` -> `z.guid()` | Yes |
| src/lib/mcp/tools/deleteScheduledPosts.ts | `z.string().uuid()` -> `z.guid()` | Yes |
| src/lib/mcp/tools/cancelScheduledPosts.ts | `z.string().uuid()` -> `z.guid()` | Yes |
| src/lib/mcp/tools/resumeScheduledPosts.ts | `z.string().uuid()` -> `z.guid()` | Yes |
| src/lib/mcp/tools/reschedulePosts.ts | `z.string().uuid()` -> `z.guid()` | Yes |
| src/lib/mcp/tools/bulkPostNow.ts | `z.string().uuid()` -> `z.guid()` | Yes |

## Key Decisions

- `z.guid()` instead of `z.uuid()`: Zod 4's `z.uuid()` enforces strict RFC 4122
  version/variant bits. `z.guid()` matches Zod 3 behavior (accepts any UUID-shaped
  string). This avoids rejecting valid UUIDs from Supabase or external sources.
- `z.string().url()`, `z.string().datetime()`, `z.coerce.*` kept as-is: backward-compatible in Zod 4, tsc passes.
- No `error.errors` -> `error.issues` migration needed: codebase already used `.issues` everywhere (set up correctly in Phases 2-5).

## Validation Response Shape Change

No external-facing change. The `safeParse().error.issues` array shape is identical
between Zod 3 and Zod 4. REST validation error responses remain:
```json
{ "error": { "code": "validation_error", "message": "...", "details": { "issues": [...] } } }
```

## Invariant Verification

| # | Check | Result |
|---|---|---|
| I1 | Zod version is 4.x | PASS (4.4.3) |
| I2 | No z.string().uuid() left | PASS (0) |
| I3 | No z.uuid() (we use z.guid()) | PASS (0) |
| I4 | No z.string().email() left | PASS (0, none existed) |
| I5 | No error.errors reads | PASS (0) |
| I6 | No .flatten()/.format() | PASS (0) |
| I7 | tsc clean | PASS |
| I8 | build clean | PASS |
| I9 | No any introduced | PASS (0) |
| I10 | No em-dash | PASS (0) |
| I11 | MCP regression | PASS |

## Risks / Open Items

- Monitor prod for any UUID validation failures (z.guid() should match all existing behavior)
- Drew runs smoke test curls on prod after deploy (valid + invalid body paths)

## Metrics

- Files modified: 14
- Lines changed: +14 / -14 (1:1 replacement)
- Zod schemas affected: 14
- No new files created
