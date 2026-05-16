# Vuln 6 Report -- Audit Redaction Bypass for Nested Arrays

**Branch:** main
**Build state:** clean (tsc --noEmit + npm run build)
**Generated:** 2026-05-15

## Summary

Fixed the array-recursion gap in `redactSecrets`. Extracted a `redactValue`
helper that handles any input type recursively: strings get JWT detection,
arrays get mapped over element-by-element, plain objects recurse into
`redactSecrets` for key-based redaction, and primitives pass through.
This covers arrays of objects, arrays of arrays, arrays of JWT strings,
and any nesting depth.

## Files Modified

| File | Change |
|---|---|
| src/lib/api/audit/redactPatterns.ts | Extracted `redactValue()` helper. `redactSecrets` delegates all non-key-matched values to `redactValue`. Old inline `else if` chain replaced. |

## Approach

Option B (redactValue refactor). The file is small (77 lines post-edit) and
the helper provides a single recursive entry point for any value type. This
handles all depths uniformly without code duplication.

## Behavior Change

| Input shape | Before | After |
|---|---|---|
| Top-level object key match | Redacted | Unchanged |
| Nested object key match | Redacted | Unchanged |
| Array of objects with sensitive keys | NOT redacted (BUG) | Redacted |
| Array of arrays of objects | NOT redacted | Redacted |
| Array of JWT strings | NOT redacted | Redacted |
| Primitives (numbers, booleans, null) | Pass through | Unchanged |
| Empty arrays | Pass through | Unchanged |

## Test Coverage

No test infrastructure exists for `redactSecrets`. Edge cases verified by
code review tracing the recursion paths:

| # | Input | Expected output | Verified |
|---|---|---|---|
| 1 | `{ access_token: "x" }` | `{ access_token: "[REDACTED]" }` | Yes (line 34, key match) |
| 2 | `{ user: { access_token: "x" } }` | `{ user: { access_token: "[REDACTED]" } }` | Yes (line 58-59, object recurse) |
| 3 | `{ accounts: [{ access_token: "x" }] }` | `{ accounts: [{ access_token: "[REDACTED]" }] }` | Yes (line 55-56, array map -> object recurse) |
| 4 | `{ data: [[{ secret: "x" }]] }` | `{ data: [[{ secret: "[REDACTED]" }]] }` | Yes (nested array map) |
| 5 | `{ tokens: ["eyJhbGc.eyJzdWI.sig"] }` | `{ tokens: ["[REDACTED_JWT]"] }` | Yes (line 52-53, string JWT check) |
| 6 | `{ items: [1, "plain", null] }` | `{ items: [1, "plain", null] }` | Yes (line 61, primitive passthrough) |
| 7 | `{ items: [] }` | `{ items: [] }` | Yes (line 56, empty array maps to []) |
| 8 | `{ deep: { list: [{ inner: { secret: "x" } }] } }` | secret redacted at depth 4 | Yes (object -> array -> object -> key match) |
| 9 | Circular reference | Not guarded (no circular refs expected in JSON-serializable audit data) | Known limitation, unchanged |
| 10 | `{ key: undefined }` | `{ key: undefined }` | Yes (line 61, primitive passthrough) |

## Invariant Verification

| # | Check | Result |
|---|---|---|
| I1 | `Array.isArray` present in redactPatterns.ts | OK (line 55) |
| I2 | No `any` introduced | OK |
| I3 | `redactValue` called from `redactSecrets` (line 37), recurses into `redactSecrets` (line 59) | OK |
| I4 | No em-dash | OK |
| I5 | `REDACT_KEYS` regex unchanged | OK |
| I6 | tsc --noEmit + npm run build clean | OK |

## Smoke Test Results

Pending Drew deploy + audit log inspection.

## Risks / Open Items

- Audit log rows written BEFORE this deploy may contain plaintext tokens inside array-valued fields. A one-time cleanup query against `mcp_audit_log` and `rest_audit_log` could scrub these, but that is out of scope for this task. Flag if Drew wants a follow-up.
- Circular reference handling: not guarded. Audit log inputs are JSON-serializable (they come from `JSON.parse` of request bodies), so circular refs cannot occur in practice. Unchanged from before.
- No test runner exists for this module. If a test framework is added later, array recursion cases should be included.

## Metrics

- Files modified: 1
- Lines added: 19 (redactValue function + updated JSDoc)
- Lines removed: 9 (old inline else-if chain)
- Net: +10 lines
