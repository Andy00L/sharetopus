# Documentation Sync Report

**Branch:** main
**Date:** 2026-05-15
**Trigger:** REST API v1, webhook subsystem, Zod 4, OpenAPI/Scalar, and MDX docs shipped since previous docs era.

## Summary

Updated all 12 existing docs + README to reflect the current code state. Created 2 new docs (REST.md, WEBHOOKS.md). Removed phantom MCP resources section (documented but never built). Moved REST API from "planned" to "shipped" across all files. Updated all counts (34 tables, 12 Inngest functions, 28 REST endpoints, 0 MCP resources).

## Files Modified

| File | Major changes |
|---|---|
| README.md | REST badge shipped, 12 functions, 34 tables, add REST API description, add deliverWebhook, remove qstash mention, add Zod/OpenAPI/MDX deps, update security section |
| docs/ARCHITECTURE.md | Add REST API layer to system diagram, 34 tables, 12 functions, 27 endpoints, add REST directory structure, add Zod 4 + webhook tradeoffs, update tech stack versions |
| docs/AUTH.md | Add REST API authentication section, add withRestEndpoint reference |
| docs/BILLING.md | Add note that REST API shares the same quota system |
| docs/DATABASE.md | 34 tables (was 31), 2168 lines (was 1991), add rest_audit_log + webhook_subscriptions + webhook_deliveries, 9 append-only tables (was 8) |
| docs/DEVELOPMENT.md | Add REST API dev notes, Zod 4/v3 split warning, MDX docs, tsc OOM mitigation note |
| docs/INNGEST.md | 12 functions (was 11), add deliver-webhook section with flow diagram, add webhook.dispatch.v1 event |
| docs/MCP.md | Remove phantom Resources section (3 claimed, 0 in code), update bulk_schedule limitation, add Zod v3 note |
| docs/ROADMAP.md | Move REST API + webhooks + OpenAPI + Zod 4 to Shipped, remove Near-Term section, remove QStash issue (already removed), add x402 env var deferral note |
| docs/SCHEDULING.md | Add REST API created_via=api note, webhook dispatch reference |
| docs/SECURITY.md | Add 4 new threat model entries (REST auth, REST audit, outbound webhook signing, webhook auto-disable), add outbound webhook signing section, add rest_audit_log to append-only tables (9 total), update data retention |
| docs/STORAGE.md | Add REST API media endpoints section |
| src/lib/mcp/README.md | Remove phantom resources/ directory reference |

## Files Created

| File | Lines | Reason |
|---|---|---|
| docs/REST.md | 234 | No existing doc for 28 shipped REST endpoints |
| docs/WEBHOOKS.md | 228 | No existing doc for webhook subsystem internals |
| DOCS_SYNC_REPORT.md | this file | Required by prompt |

## Numbers Verified

| Claim | Grep used | Real value |
|---|---|---|
| 34 database tables | Count table definitions in database.types.ts | 34 |
| 2168 lines in database.types.ts | `wc -l` | 2168 |
| 28 REST endpoint handlers | 27 via `withRestEndpoint` + 1 public `function GET()` (openapi.json) | 28 |
| 18 MCP tools | `grep registerTool(` in src/lib/mcp | 18 |
| 3 MCP prompts | `grep server.prompt(` in src/lib/mcp | 3 |
| 0 MCP resources | `grep registerResource(` + `grep server.resource(` | 0 |
| 12 Inngest functions | `grep createFunction` in functions/*.ts | 12 |
| 5 webhook event types | Read eventTypes.ts | 5 |
| 10 auto-disable threshold | Read deliverWebhook.ts line 7 | 10 |
| Zod ^4.4.3 | package.json | ^4.4.3 |
| 17 files import from "zod" | `grep 'from "zod"'` in src/ | 17 |
| 19 files import from "zod/v3" | `grep 'from "zod/v3"'` in src/ | 19 |
| @upstash/qstash removed | `grep @upstash/qstash package.json` | 0 matches |

## Versions Verified

| Package | package.json | Doc claim |
|---|---|---|
| zod | ^4.4.3 | 4.4.3 |
| next | ^16.2.6 | 16.2.6 |
| react | 19.2.0 | 19.2.0 |
| @supabase/supabase-js | ^2.105.3 | 2.105.3 |
| @clerk/nextjs | ^7.3.2 | 7.3.2 |
| stripe | ^18.5.0 | 18.5.0 |
| inngest | ^4.3.0 | 4.3.0 |
| @modelcontextprotocol/sdk | ^1.29.0 | 1.29.0 |
| mcp-handler | ^1.1.0 | 1.1.0 |
| zod-openapi | ^5.4.6 | 5.4.6 |
| @scalar/nextjs-api-reference | ^0.10.16 | 0.10.16 |
| tailwindcss | ^4.2.4 | 4.2.4 |
| typescript | ^5.9.3 | 5.9.3 |

## Discrepancies Resolved

| File | Issue | Resolution |
|---|---|---|
| All docs | "31 tables" | Updated to 34 |
| README + ARCHITECTURE + INNGEST | "11 Inngest functions" | Updated to 12 |
| README + ROADMAP | REST API "planned/not built" | Updated to shipped |
| MCP.md + src/lib/mcp/README.md | "3 read-only resources" | Removed section (0 in code, no resources/ dir) |
| README | @upstash/qstash "unused dep" | Removed mention (already deleted from package.json) |
| ARCHITECTURE | zod version 3.25.76 | Updated to 4.4.3 |
| ARCHITECTURE | "4 surfaces, 2 shipped" | Updated to "4 surfaces, 3 shipped" |

## .env.example

No changes. Five x402 env vars (`X402_HMAC_SECRET`, `X402_*_REDIRECT_URI`) are intentionally excluded until x402 ships. Documented in ROADMAP.md.

## Invariant Verification

- Em-dashes in docs: 0 (grep verified)
- Banned words in docs: 0 (grep verified)
- `npx tsc --noEmit`: clean
- `npm run build`: clean

## Style Audit

- Em-dashes: 0
- Banned words: 0
- Empty superlatives: 0

## Diff Stats

- Files modified: 13
- Files created: 3
- Lines added: 266
- Lines removed: 86
