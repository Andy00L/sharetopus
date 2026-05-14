# Web RequestId Propagation Report

**Branch:** main (direct commit)
**Build state:** green (tsc + next build)
**Generated:** 2026-05-14

## Summary

Created `src/lib/utils/generateRequestId.ts`, a server-only helper that wraps `crypto.randomUUID()`. Updated 6 web server action files (7 callsites total) to generate a request ID and pass it as the last param to the 6 core batch functions. Logs now show `[req=<uuid>]` instead of `[req=?]` for all web-initiated actions.

## Files Modified

| File | Change | +/- | Risk |
|---|---|---|---|
| `src/lib/utils/generateRequestId.ts` | New helper (16 lines) | +16/0 | Trivial, pure function |
| `src/actions/server/directPostActions/directPostBatchAction.ts` | Import helper, generate + pass requestId to `directPostBatch` | +3/1 | Low |
| `src/actions/server/scheduleActions/cancel/cancelScheduledPostBatchAction.ts` | Import helper, generate + pass requestId to `cancelScheduledPostBatch` | +3/1 | Low |
| `src/actions/server/scheduleActions/delete/deleteScheduledPostBatchAction.ts` | Import helper, generate + pass requestId to `deleteScheduledPostBatch` | +3/1 | Low |
| `src/actions/server/scheduleActions/resume/resumeScheduledPostBatchAction.ts` | Import helper, generate + pass requestId to `resumeScheduledPostBatch` | +3/1 | Low |
| `src/actions/server/scheduleActions/reschedule/updateScheduledTimeBatchAction.ts` | Import helper, generate + pass requestId to `updateScheduledTimeBatch` | +3/1 | Low |
| `src/actions/server/handleSocialMediaPost/handleSocialMediaPost.ts` | Import helper, generate requestId once at top, thread through both code paths (`scheduleAllPosts`, `directPostFromForm`) | +7/3 | Low (private helper signatures expanded) |

## Investigation Set (Phase 0 proof)

| File | Total lines | Functions / exports | Notes |
|---|---|---|---|
| `src/lib/types/database.types.ts` | 1991 | 15 tables, convenience types, enum aliases | Read first per iron rule. No changes needed. |
| `src/lib/utils/generateBatchId.ts` | 25 | `generateBatchId()` | Convention template for new helper |
| `src/lib/mcp/withMcpTool.ts` | 241 | `withMcpTool()`, `McpToolContext`, `McpHandlerResult` | requestId extracted via `extractRequestId(extra)` at line 182 |
| `src/lib/mcp/context.ts` (lines 100-119) | ~120+ | `extractRequestId()` | Reads `authInfo.extra.requestSessionId` from MCP protocol |
| `src/actions/server/scheduleActions/schedule/schedulePostBatch.ts` | 479 | `schedulePostBatch(posts, principalId, source, requestId?)` | 4th param. Already logs `[req=<uuid>]` |
| `src/actions/server/directPostActions/directPostBatch.ts` | 507 | `directPostBatch(posts, principalId, source, agentSuppliedBatchId?, requestId?)` | 5th param. Already logs `[req=<uuid>]` |
| `src/actions/server/scheduleActions/cancel/cancelScheduledPostBatch.ts` | 124 | `cancelScheduledPostBatch(postIds, principalId, source, requestId?)` | 4th param |
| `src/actions/server/scheduleActions/delete/deleteScheduledPostBatch.ts` | 161 | `deleteScheduledPostBatch(postIds, principalId, source, requestId?)` | 4th param |
| `src/actions/server/scheduleActions/resume/resumeScheduledPostBatch.ts` | 158 | `resumeScheduledPostBatch(postIds, principalId, source, requestId?)` | 4th param |
| `src/actions/server/scheduleActions/reschedule/updateScheduledTimeBatch.ts` | 186 | `updateScheduledTimeBatch(postIds, newScheduledTime, principalId, source, requestId?)` | 5th param |
| `src/actions/server/directPostActions/directPostBatchAction.ts` | 42 | `directPostBatchAction()` | Web wrapper, MODIFIED |
| `src/actions/server/scheduleActions/cancel/cancelScheduledPostBatchAction.ts` | 35 | `cancelScheduledPostBatchAction()` | Web wrapper, MODIFIED |
| `src/actions/server/scheduleActions/delete/deleteScheduledPostBatchAction.ts` | 43 | `deleteScheduledPostBatchAction()` | Web wrapper, MODIFIED |
| `src/actions/server/scheduleActions/resume/resumeScheduledPostBatchAction.ts` | 34 | `resumeScheduledPostBatchAction()` | Web wrapper, MODIFIED |
| `src/actions/server/scheduleActions/reschedule/updateScheduledTimeBatchAction.ts` | 37 | `updateScheduledTimeBatchAction()` | Web wrapper, MODIFIED |
| `src/actions/server/handleSocialMediaPost/handleSocialMediaPost.ts` | 661 | `handleSocialMediaPost()`, `scheduleAllPosts()`, `directPostFromForm()` | Orchestrator, MODIFIED (2 callsites, 1 requestId) |

## MCP Pattern Found

MCP requestId is extracted from the protocol layer via `extractRequestId(extra)` in `withMcpTool.ts:182`. It reads `authInfo.extra.requestSessionId`, which is set by `route.ts` per JSON-RPC request. All 8 MCP tool callsites already pass `ctx.requestId` to core batch functions.

Refactored to use new helper: **no**. Reason: MCP's requestId originates from the protocol layer (route.ts stashes the per-request session UUID into authInfo), not from an inline `crypto.randomUUID()` call. No code to consolidate.

## Invariant Verification

| # | Grep | Result |
|---|---|---|
| I1 | `rg -l generateRequestId src/` | 7 files (1 definition + 6 callsites). PASS |
| I2 | `rg "Batch\([^,)]+\);$" src/actions/server/` | 0 matches. All callsites now pass requestId. PASS |
| I3 | `rg "crypto.randomUUID" src/` | Only in `generateRequestId.ts:15` (the helper) and `generateBatchId.ts:16` (a comment). PASS |
| I4 | em-dash check on modified files | 0 hits. PASS |
| I5 | `npx tsc --noEmit` | 0 errors. PASS |
| I6 | `npm run build` | Compiled, 37 pages generated. PASS |

## Edge Cases Handled

| # | Edge case | Expected behavior | Source |
|---|---|---|---|
| 1 | Web action invoked twice in parallel | Each gets a different UUID. `crypto.randomUUID()` is collision-safe. | `generateRequestId.ts` |
| 2 | `handleSocialMediaPost` calls 2 core functions in sequence (cannot happen, mutually exclusive paths) | Same requestId would be passed to both if it could. One requestId generated at `handleSocialMediaPost.ts:136`. | `handleSocialMediaPost.ts:136` |
| 3 | Core function called without requestId (legacy callsite missed) | Logs show `[req=?]` (existing fallback). Build still green. | All core batch functions |
| 4 | requestId is null | Core function handles null gracefully (already implemented for MCP). | All core batch functions |
| 5 | requestId in Inngest event payload | Worker reads `data.request_id ?? null`, never throws. | `directPostBatch.ts:501` |

## Decisions Made

- Helper location: `src/lib/utils/generateRequestId.ts` (matches `generateBatchId.ts` pattern)
- MCP refactor: skipped (MCP requestId comes from protocol layer, not inline UUID generation)
- Parallel server actions: rely on `crypto.randomUUID()` collision safety
- One requestId per server action invocation: confirmed (not per loop iteration)
- `handleSocialMediaPost`: one requestId at function entry, threaded through private helpers

## Open Items

- MCP refactor was not applicable: MCP uses protocol-layer requestSessionId, web uses `generateRequestId()`. Two different sources, both correct.
- Edge runtime check: confirmed `crypto.randomUUID()` works in both Node and Edge (Web Crypto API).

## Metrics

- Files created: 1
- Files modified: 6
- Lines added: ~38
- Lines removed: ~7
- Commits: 1
- Pause-and-ask interactions: 1
