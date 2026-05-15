# Vuln 2 Report -- Reflected XSS in OAuth Connect Routes

**Branch:** main
**Build state:** clean (tsc --noEmit + npm run build)
**Generated:** 2026-05-15

## Summary

Eliminated reflected XSS in 4 OAuth connect routes (Instagram, LinkedIn, Pinterest, TikTok) by escaping all externally-controlled strings before interpolation into HTML responses. Extracted the existing local `escapeHtml` helper from the callback route into a shared module at `src/lib/api/oauth/escapeHtml.ts` and added a `toJsString` helper for inline `<script>` JS string context. Applied `toJsString` for all JS string interpolations and `escapeHtml` for all HTML body interpolations across every connect route.

## Files Created / Updated

| File | Lines | Purpose |
|---|---|---|
| src/lib/api/oauth/escapeHtml.ts | 40 | Shared escapeHtml + toJsString helpers (updated escapeHtml signature to accept string/null/undefined) |

## Files Modified

| File | Change | Reason |
|---|---|---|
| src/app/api/oauth/callback/[platform]/route.ts | Imported escapeHtml from shared module, deleted local function | Single source of truth for escapeHtml |
| src/app/api/social/instagram/connect/route.ts | Escaped 9 interpolations (3 external + 6 hardcoded) | Vuln 2 fix |
| src/app/api/social/linkedin/connect/route.ts | Escaped 8 interpolations (1 external + 7 hardcoded) | Vuln 2 fix |
| src/app/api/social/pinterest/connect/route.ts | Escaped 6 interpolations (2 external + 4 hardcoded) | Vuln 2 fix |
| src/app/api/social/tiktok/connect/route.ts | Escaped 6 interpolations (4 external + 2 hardcoded) | Vuln 2 fix |

## Interpolations Fixed (count by file)

| File | JS string context | HTML body context | Total |
|---|---|---|---|
| instagram | 9 | 0 | 9 |
| linkedin | 8 | 0 | 8 |
| pinterest | 5 | 1 | 6 |
| tiktok | 3 | 3 | 6 |
| **Total** | **25** | **4** | **29** |

## Invariant Verification

| # | Check | Result |
|---|---|---|
| I1 | Helper file exists with both functions | OK |
| I2 | Callback route imports escapeHtml, no local function | OK |
| I3 | All 4 connect routes import the helpers | OK (instagram, linkedin, pinterest, tiktok) |
| I4 | No unescaped `"${errorDescription` interpolation remains | OK |
| I5 | No unescaped `"${error ` interpolation in script context | OK |
| I6 | No `throw new` in business logic | OK |
| I7 | No `any` introduced | OK |
| I8 | No em-dash in modified files | OK |
| I9 | toJsString handles `</script>` breakout | Confirmed in code review (regex: `/<\/(?=\s*script)/gi`) |
| I10 | Build clean | OK (tsc --noEmit + npm run build) |

## Edge Case Audit

| # | Input | Expected behavior | Status |
|---|---|---|---|
| 1 | `?error_description="><script>alert(1)</script>` | Rendered as JS string literal via JSON.stringify, no execution | Safe |
| 2 | `?error_description=");alert(1)//` | Quote escaped by JSON.stringify, no break-out | Safe |
| 3 | `?error_description=` + 1000 backslashes | All escaped by JSON.stringify | Safe |
| 4 | `?error_description=` + U+2028 byte | Escaped to `\u2028` by toJsString post-processing | Safe |
| 5 | `?error_description=</script><script>alert(1)</script>` | `</script>` escaped to `<\/script>` by toJsString | Safe |
| 6 | Missing error_description (only error) | Falls through to error value via `??`, still escaped | Safe |
| 7 | Both missing | Empty string default via `?? ""`, produces `""` literal | Safe |
| 8 | Successful callback (no error) | No change in behavior, success path has no external interpolations | Safe |
| 9 | Token exchange failure with attacker-controlled provider response | `tokenResponse.message` wrapped in toJsString (Instagram) | Safe |
| 10 | DB error with attacker-influenced Supabase error message | Hardcoded "Database error" string used, safe regardless | Safe |

## Smoke Test Results

Pending Drew deploy + curl verification.

## Defense In Depth

No CSP header is present in `next.config.ts`, `src/middleware.ts`, or `vercel.json`. This XSS fix (input escaping via `toJsString` for JS context and `escapeHtml` for HTML context) is the sole defense against reflected XSS in these routes. Adding a CSP header with `script-src 'self'` (and removing inline scripts) would provide a second layer but is out of scope for this task.

## Risks / Open Items

1. The `console.error` log lines in each connect route still interpolate `error` and `errorDescription` unsanitized into server-side log output. This is not an XSS vector (server-side only) but could be a log injection vector (Vuln 3 scope, not addressed here).
2. The hardcoded strings wrapped with `toJsString` for consistency (e.g. `toJsString("Database error")`) produce output like `"Database error"` (with quotes). This is correct since `toJsString` includes surrounding quotes and the old pattern `"Database error"` also had quotes. The JS execution is identical.
3. The `escapeHtml` signature was widened from `string` to `string | null | undefined`. The callback route passes `string` to it (from `buildHtmlPage` params), which is still compatible. No type regression.

## Metrics

- Files created/updated: 1
- Files modified: 5
- Lines added (tracked files): 34
- Lines removed (tracked files): 49
- Interpolations escaped: 29 total (10 external-input, 19 hardcoded consistency)
