# Documentation Audit: Master Index

**Repository:** `~/CODE/personal/sharetopus/sharetopus`
**Branch:** `main`
**HEAD:** `2f2794e07214a37b61249e44e6f0a0c059ec8856`
**Date:** 2026-05-12
**Pre-read source files:** 90+ (13 reference docs, 28 route handlers, 33 x402 lib files, 43 MCP lib files, 43 platform lib files, 10 _internal actions, 15 Inngest functions, database types, plans config, middleware, and all recon docs)
**Surfaces audited:** Web (Clerk dashboard), MCP (AI agent tools), x402 (crypto per-call payment)

All files listed in the mandatory pre-read section were read before any documentation was written.

## Navigation

| # | File | What it covers |
|---|---|---|
| 1 | [01_OVERVIEW.md](./01_OVERVIEW.md) | Top-level architecture: 3 surfaces + shared layer |
| 2 | [02_WEB_POST_SCHEDULE_FLOW.md](./02_WEB_POST_SCHEDULE_FLOW.md) | Web: post creation to schedule to execution |
| 3 | [03_MCP_POST_SCHEDULE_FLOW.md](./03_MCP_POST_SCHEDULE_FLOW.md) | MCP: schedule_post tool to execution |
| 4 | [04_X402_FLOWS.md](./04_X402_FLOWS.md) | x402: register, connect, OAuth callback, status poll |
| 5 | [05_SHARED_INTERNAL_ACTIONS.md](./05_SHARED_INTERNAL_ACTIONS.md) | `_internal/` layer used by Web + MCP |
| 6 | [06_PER_PLATFORM_LIBS.md](./06_PER_PLATFORM_LIBS.md) | LinkedIn/TikTok/Pinterest/Instagram per-platform code |
| 7 | [07_DB_TOUCHES_PER_SURFACE.md](./07_DB_TOUCHES_PER_SURFACE.md) | Which surface reads/writes which tables |
| 8 | [08_IMPORTS_MAP.md](./08_IMPORTS_MAP.md) | Cross-reference: who imports what |
| 9 | [09_DUPLICATION_ANALYSIS.md](./09_DUPLICATION_ANALYSIS.md) | Duplication patterns and refactor opportunities |

## Reference docs read

| File | Lines | Purpose |
|---|---|---|
| `REFERENCE_DOCUMENTATION_AUDIT.md` | 882 | Quality floor for documentation |
| `REFERENCE_SECURITY_AUDIT.md` | 730 | Security context |
| `README.md` | 303 | Repo overview |
| `ARCHITECTURE.md` (root) | 6 | Redirect to docs/ARCHITECTURE.md |
| `docs/ARCHITECTURE.md` | 410 | System design with Mermaid diagrams |
| `docs/MCP.md` | 654 | MCP tool inventory, auth, annotations |
| `docs/PLATFORMS.md` | 218 | Per-platform OAuth and posting flows |
| `docs/SCHEDULING.md` | 218 | Post lifecycle, lock tables, retries |
| `docs/INNGEST.md` | 169 | 6 background functions |
| `docs/DATABASE.md` | 165 | 29 tables, RLS posture |
| `docs/AUTH.md` | 218 | Clerk + MCP auth, principal model |
| `docs/BILLING.md` | 173 | Stripe subscriptions, plan gates |
| `docs/STORAGE.md` | 183 | Supabase Storage, orphan sweep |
| `docs/ROADMAP.md` | 142 | Deferred features |
| `docs/SECURITY.md` | 362 | Threat model, SSRF guard, HMAC proxy |
| `change/RECON_X402_PHASE_4_1.md` | 861 | Phase 4.1 register recon |
| `change/RECON_X402_PHASE_4_2.md` | 774 | Phase 4.2 connect + Solana recon |

## Source file inventory

| Category | File count | Notes |
|---|---|---|
| Total TypeScript source files | 356 | `find src -name "*.ts" -o -name "*.tsx"` |
| API route handlers (`route.ts`) | 28 | `find src/app/api -name "route.ts"` |
| Page components (`page.tsx`) | 15 | `find src/app -name "page.tsx"` |
| Web social routes | 21 | `src/app/api/social/`, `src/app/api/posts/`, `src/app/api/storage/`, `src/app/api/webhooks/` |
| MCP lib files | 43 | `src/lib/mcp/` |
| x402 route files | 4 | `src/app/api/x402/` |
| x402 lib files | 33 | `src/lib/x402/` |
| _internal actions | 10 | `src/actions/server/_internal/` |
| Per-platform libs | 43 | `src/lib/api/` |
| Inngest functions | 15 | `src/inngest/` |
| Server actions (total) | 48 | `src/actions/server/` |

## Mermaid diagram count across all files

| File | Diagram count | Types |
|---|---|---|
| `01_OVERVIEW.md` | 1 | graph TB |
| `02_WEB_POST_SCHEDULE_FLOW.md` | 4 | sequenceDiagram, graph LR, stateDiagram |
| `03_MCP_POST_SCHEDULE_FLOW.md` | 3 | sequenceDiagram, graph TB |
| `04_X402_FLOWS.md` | 5 | sequenceDiagram, erDiagram |
| `05_SHARED_INTERNAL_ACTIONS.md` | 2 | graph TB |
| `06_PER_PLATFORM_LIBS.md` | 2 | graph LR |
| `07_DB_TOUCHES_PER_SURFACE.md` | 2 | graph LR, erDiagram |
| `08_IMPORTS_MAP.md` | 3 | graph TD |
| `09_DUPLICATION_ANALYSIS.md` | 1 | graph LR |
| **Total** | **23** | |

[Back to README](../../README.md)
