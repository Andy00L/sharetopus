# Documentation Overhaul Report

**Branch:** main (direct commit)
**Build state:** N/A (docs-only)
**Generated:** 2026-05-14

## Summary

Full rewrite of README.md and all 12 docs in `/docs/`. Updated to match production reality: 31 tables (was 29), 11 Inngest functions (was 6), MCP Creator+ minimum (was mixed Free/Starter/Creator/Pro), TikTok webhook integration, withMcpTool HOF, API key expiry, web requestId tracing, data retention crons. Zero source code changes.

## Files Modified

| File | Lines before | Lines after | Notes |
|------|-------------|-------------|-------|
| README.md | 303 | 201 | Restructured with badges, expanded MCP/billing/jobs sections |
| docs/ARCHITECTURE.md | 410 | 551 | Updated all counts, added 5 new Inngest functions, TikTok webhook flow |
| docs/AUTH.md | 219 | 380 | Added API key expiry options, OAuth client trust, entitlement details |
| docs/BILLING.md | 173 | 238 | Hybrid pricing (Creator+ for MCP), updated quotas, grace period |
| docs/DATABASE.md | 165 | 307 | 31 tables (was 29), 8 append-only (was 6), 3 state diagrams |
| docs/DEVELOPMENT.md | 160 | 328 | Expanded env vars, added requestId tracing convention |
| docs/INNGEST.md | 169 | 298 | 11 functions (was 6), fixed poll interval 60s (was 10s) |
| docs/MCP.md | 654 | 874 | withMcpTool HOF section, Creator+ minimum, updated quotas |
| docs/PLATFORMS.md | 218 | 395 | Generic adapter pattern, TikTok webhook+poll dual path |
| docs/ROADMAP.md | 142 | 232 | 16 shipped items, updated in-flight/planned |
| docs/SCHEDULING.md | 218 | 304 | Cross-platform fan-out, subscription-triggered cancel |
| docs/SECURITY.md | 362 | 486 | 17 threats (was 13), 90-day retention, XSS prevention |
| docs/STORAGE.md | 185 | 312 | Cover timestamps, security section, expanded proxy details |
| docs/review/* | (deleted) | 0 | 10 files removed per instruction |

## Investigation Set (Phase 0 proof)

| File | Total lines | Purpose | Notes |
|------|-------------|---------|-------|
| .claude/prompt/REFERENCE_DOCUMENTATION_AUDIT.md | 0 | Reference doc | Does not exist |
| .claude/prompt/REFERENCE_SECURITY_AUDIT.md | 0 | Reference doc | Does not exist |
| src/lib/types/database.types.ts | 1991 | Schema source of truth | 31 tables, 2 RPC functions |
| package.json | 103 | Dependencies | Versions verified |
| src/lib/mcp/auth/resolve.ts | 84 | MCP auth dispatcher | API key + OAuth paths |
| src/lib/mcp/withMcpTool.ts | 240 | Tool HOF wrapper | Auth, entitlement, audit |
| src/lib/mcp/apiKeyExpiry.ts | 27 | Expiry constants | 7/30/90/365 days |
| src/lib/mcp/ipHash.ts | 76 | IP anonymization | SHA-256 + salt |
| src/lib/mcp/audit.ts | 216 | Audit logging | 13-key redaction, 4096 truncation |
| src/lib/mcp/entitlement.ts | 269 | Plan gating | Creator+ minimum, atomic quotas |
| src/lib/mcp/context.ts | 119 | Request context | Principal, session, IP, UA extraction |
| src/app/api/mcp/[transport]/route.ts | 257 | MCP endpoint | 100/60s rate limit, clientInfo |
| src/app/api/inngest/route.ts | 40 | Inngest serve | 11 functions registered |
| src/inngest/functions/processTikTokPublishWebhook.ts | 128 | Webhook processor | 3 retries, idempotent |
| src/inngest/functions/tikTokPublishStatusPoll.ts | 171 | Poll worker | 60 attempts, 60s interval |
| src/app/api/webhooks/tiktok/publish/route.ts | 190 | Webhook receiver | HMAC-SHA256, 300s tolerance |
| src/app/api/webhooks/stripe/route.ts | 268 | Stripe webhooks | 5 events handled |
| src/lib/types/plans.ts | 232 | Plan tiers | Starter/Creator/Pro, price IDs |
| src/lib/jobs/runtimeConfig.ts | 72 | Runtime config | All tunable constants |
| src/actions/server/directPostActions/directPostBatch.ts | 507 | Direct post batch | 30 max, 20/60s |
| src/actions/server/scheduleActions/schedule/schedulePostBatch.ts | 479 | Schedule batch | 50 max, 10/60s |
| src/lib/api/_shared/directPostForAccountsGeneric.ts | 268 | Generic adapter | DirectPostPlatformAdapter type |
| src/lib/api/tiktok/buildProxiedTikTokMediaUrl.ts | 66 | Proxy URL builder | 30-min expiry, HMAC-SHA256 |
| src/actions/server/data/finalizeTikTokPostByPublishId.ts | 241 | TikTok finalize | Idempotent, deep link |
| src/actions/checkActiveSubscription.ts | 78 | Sub check | active/trialing/past_due |
| src/actions/server/rateLimit/checkRateLimit.ts | 116 | Rate limiter | Upstash sliding window |

## Reality vs Previous Doc Drift

| Doc | Claim that was stale | New text |
|------|---------------------|----------|
| INNGEST.md | "6 background functions" | 11 functions (5 new: webhook processor, 3 cleanup crons, stale OAuth sweep) |
| INNGEST.md | "TikTok poll interval: 10 seconds" | 60 seconds (tikTokPublishPollIntervalMs: 60000) |
| INNGEST.md | "Total ceiling: ~10 minutes" | ~60 minutes (matches TikTok's 1-hour PROCESSING_DOWNLOAD timeout) |
| DATABASE.md | "29 Postgres tables" | 31 tables (added tiktok_webhook_events, pending_direct_posts was missing from count) |
| DATABASE.md | "6 append-only tables" | 8 append-only tables |
| MCP.md/README | "Free tier: 6 read tools, Starter+: write tools" | All 18 tools require Creator+ minimum |
| BILLING.md | "Starter: 100/mo for schedule_post" | Starter: 0 (blocked from MCP entirely) |
| BILLING.md | "generate_post_draft: Pro only" | Creator 100/mo, Pro unlimited |
| SECURITY.md | "mcp_audit_log grows indefinitely" | 90-day retention via cleanup-mcp-audit-log cron |
| ARCHITECTURE.md | "292 TypeScript source files" | Updated (agent counted 346) |

## Diagrams Added / Updated

| File | Diagram | Notes |
|------|---------|-------|
| ARCHITECTURE.md | System overview | Updated to show 11 functions grouped by type |
| ARCHITECTURE.md | TikTok webhook+poll data flow | New diagram |
| AUTH.md | MCP resolve flow | Updated with three-step OAuth path |
| AUTH.md | API key state machine | New diagram |
| DATABASE.md | State diagrams (3) | scheduled_posts, pending_direct_posts, pending_tiktok_pulls |
| INNGEST.md | tiktok-publish-status-poll | Updated with 60s interval, early-exit |
| PLATFORMS.md | Generic adapter flowchart | New diagram |
| PLATFORMS.md | TikTok dual-path sequence | New diagram showing webhook + poll convergence |
| SECURITY.md | Defense layers | New diagram |
| STORAGE.md | Media proxy sequence | New/expanded diagram |

## Invariant Verification

| Check | Result |
|-------|--------|
| I1: Every doc has source files reference | PASS (12/12) |
| I2: Every doc has at least one diagram | PASS (46 Mermaid blocks across 12 files) |
| I3: README links to every doc | PASS (12/12) |
| I4: No em-dash anywhere | PASS (0 occurrences in README + docs/) |
| I5: No buzzwords | PASS (0 occurrences in README + docs/) |
| I6: No source code modified | PASS (only README.md, docs/*.md, docs/review/* in diff) |

## Open Items (in code, NOT fixed in this commit)

1. **src/lib/mcp/entitlement.ts**: `generate_post_draft` shows Creator 100/mo in MONTHLY_CAPS but old comments suggest it was Pro-only. The code is authoritative; this may confuse users who remember the old gating.

2. **src/inngest/functions/tikTokPublishStatusPoll.ts**: The 60s poll interval means TikTok posts take 1-60s to detect completion after the platform finishes. The webhook path eliminates this latency when webhooks arrive first.

3. **analytics_metrics table**: Exists in schema, `get_account_analytics` MCP tool reads from it, but no cron or background job populates it. The tool returns empty data for most users.

4. **@upstash/qstash dependency**: Listed in package.json but not imported anywhere. Safe to remove.

5. **Instagram connect button**: Commented out in connections page UI. Backend OAuth and posting routes are functional.

## Decisions Made

- Demo images preserved at `./public/landing.png`, `./public/dashboard.png`, `./public/create-post.png`
- Mermaid diagrams kept everywhere (all existing docs used Mermaid)
- docs/review/ deletions included in this commit
- Untracked root files (SOURCE_OF_TRUTH_PLANS_AUDIT.md, TIKTOK_*.md) left alone
- MCP tier gates: confirmed Creator+ minimum is intentional (hybrid pricing refactor)
- Memory worktree rule overridden by explicit prompt instruction

## Metrics

- Files modified: 13 (README + 12 docs) + 10 deleted (docs/review/)
- Total lines in final docs: 4,907 (README 201 + docs 4,706)
- Lines added: ~2,700
- Lines removed: ~1,200
- Commits: 1
- Pause-and-ask interactions: 1 (Phase 0 report confirming tier gates, Mermaid, commit strategy)
