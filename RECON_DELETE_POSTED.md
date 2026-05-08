# Recon: scheduled_posts delete-on-success

Date: 2026-05-08
Branch: main
Last commit: 914925b fix(direct post): pinterest chunk time

## Executive summary

The proposed change (DELETE the `scheduled_posts` row on successful post instead of marking it `status='posted'`) is safe. No application code depends on `status='posted'` rows existing in `scheduled_posts`. The Posted page reads from `content_history` (separate table). The worker's re-invocation guard already handles the "row not found" case identically to "row already posted." Two foreign keys (`content_history.scheduled_post_id`, `x402_charges.scheduled_post_id`) both use `ON DELETE SET NULL`, and neither column is ever populated by application code, so the cascade is a no-op. The web scheduled page and MCP `list_scheduled_posts` tool currently return posted rows, but both surfaces improve when those rows are absent (less noise, cleaner list). The primary implementation surface is a single function: `recordPostStatus` in `processSinglePostHelpers.ts`.

## Current behavior

### Where status='posted' is written

`src/inngest/functions/processSinglePostHelpers.ts:479-489`:
```ts
if (result.ok) {
    const { data, error } = await adminSupabase
      .from("scheduled_posts")
      .update({
        status: "posted" satisfies PostStatus,
        posted_at: nowIso,
        error_message: null,
        updated_at: nowIso,
      })
      .eq("id", post.id)
      .eq("status", "processing" satisfies PostStatus)
      .select("id");
```

This is the ONLY place in the codebase that writes `status='posted'` to `scheduled_posts`. The `directPostFor*` functions write `status: "posted"` to `content_history`, which is a different table (confirmed below).

### Where status='failed' is written

`src/inngest/functions/processSinglePostHelpers.ts:510-519`:
```ts
const { data, error } = await adminSupabase
    .from("scheduled_posts")
    .update({
      status: "failed" satisfies PostStatus,
      error_message: errorMessage,
      updated_at: nowIso,
    })
    .eq("id", post.id)
    .eq("status", "processing" satisfies PostStatus)
    .select("id");
```

### CAS guards on each UPDATE

| Operation | File:line | Guard |
|---|---|---|
| Claim for processing | processSinglePostHelpers.ts:130 | `.in("status", ["scheduled","queued"])` |
| Mark posted | processSinglePostHelpers.ts:488 | `.eq("status", "processing")` |
| Mark failed | processSinglePostHelpers.ts:518 | `.eq("status", "processing")` |
| Mark queued (tick) | scheduledPostsTickHelpers.ts:65 | `.eq("status", "scheduled")` |

### Step ordering in the worker

`src/inngest/functions/processSinglePost.ts:48-132`:

1. `fetch-post-and-account` (line 48) - reads row + account
2. compatibility check (inline, line 59)
3. `claim-post` (line 82) - CAS: scheduled/queued -> processing
4. `build-signed-urls` (line 89)
5. `call-platform-direct-post` (line 106) - calls directPostFor* (writes content_history on success, failed_posts on failure)
6. `record-status` (line 117) - CAS: processing -> posted/failed. **Awaited synchronously** via `step.run`.
7. `cleanup-storage` (line 126) - deletes media if no other rows reference it. Runs AFTER record-status.

`record-status` is awaited synchronously (`await step.run`), not fire-and-forget. `cleanup-storage` runs after `record-status` completes.

### Re-invocation guard

`src/inngest/functions/processSinglePostHelpers.ts:63-68`:
```ts
const terminalStates: PostStatus[] = ["posted", "failed", "cancelled"];
if (terminalStates.includes(post.status as PostStatus)) {
    return {
      success: true,
      message: `post already ${post.status}`,
      skip: true,
    };
}
```

If the row is deleted instead of marked posted, `fetchPostAndAccount` handles the missing-row case at lines 51-53:
```ts
if (postErr.code === "PGRST116") {
    return { success: true, message: "post not found", skip: true };
}
```

Both paths produce `skip: true`. The worker returns `{ skipped: true }` in either case (`processSinglePost.ts:53-57`). Same outcome via different path.

## Existing delete helpers

| Helper | File:line | Signature | Ownership check | Currently called from |
|---|---|---|---|---|
| `deleteScheduledPostBatchInternal` | `_internal/scheduleActions/deleteScheduledPostBatch.ts:24` | `(postIds: string[], principalId: string) -> Promise<{success, message, details?}>` | Yes (principal_id check, line 46) | MCP `deleteScheduledPosts` tool, web UI via public wrapper |
| `deleteScheduledPostBatch` | `scheduleActions/deleteScheduledPost.ts:17` | `(postIds: string[], userId: string \| null, cronSecret?: string) -> Promise<{success, message, ...}>` | Yes (authCheck/authCheckCronJob + ownership in internal) | `BatchedPostCard` UI, MCP tool |

Both helpers delete rows by ID with no status filter (line 38-55 of `deleteScheduledPostBatch.ts`). They also clean up orphaned media via `deleteSupabaseFileActionInternal`.

Neither helper is directly reusable for the worker's purpose. The worker needs an admin-level single-row delete without ownership checks (the worker operates on behalf of the system, not a principal). The closest approach: a raw `adminSupabase.from("scheduled_posts").delete().eq("id", post.id)` inline in `recordPostStatus`, mirroring the existing UPDATE's structure.

## Every reader of scheduled_posts

| File:line | Status filter | Caller surface | Affected by removing posted rows? |
|---|---|---|---|
| `scheduledPostsTickHelpers.ts:22-27` | `.eq("status", "scheduled")` | Inngest dispatcher | No |
| `scheduledPostsTickHelpers.ts:59-66` | `.eq("status", "scheduled")` | Inngest dispatcher | No |
| `processSinglePostHelpers.ts:44-48` | None (single by ID) | Worker fetch | No (skip if missing; see re-invocation guard above) |
| `processSinglePostHelpers.ts:123-131` | `.in("status", ["scheduled","queued"])` | Worker claim | No |
| `processSinglePostHelpers.ts:479-489` | `.eq("status", "processing")` | Worker mark posted | **YES: this is the line being changed to DELETE** |
| `processSinglePostHelpers.ts:510-519` | `.eq("status", "processing")` | Worker mark failed | No |
| `_internal/scheduleActions/getScheduledPosts.ts:29-51` | Optional (no default) | Web UI `PostsGrid`, MCP `list_scheduled_posts`, MCP resource | **YES: posted rows no longer returned. Functionally cleaner.** |
| `_internal/scheduleActions/deleteScheduledPostBatch.ts:37-41` | None (by ID) | MCP/UI delete | No (if row gone, nothing to delete) |
| `_internal/scheduleActions/cancelScheduledPostBatch.ts:27-41` | None (fetch), line 41 filters `status="scheduled"` | MCP/UI cancel | No |
| `_internal/scheduleActions/resumeScheduledPostBatch.ts:28-41` | None (fetch), line 41 filters `status="cancelled"` | MCP/UI resume | No |
| `_internal/scheduleActions/updateScheduledTimeBatch.ts:37-51` | None (fetch), lines 50-51 filter `"scheduled"/"cancelled"` | MCP reschedule | No |
| `disconnectSocialAccount.ts:111-114` | `.in("status", ["scheduled","processing"])` | Account disconnect | No |
| `disconnectSocialAccount.ts:165-168` | `.in("status", ["scheduled","processing"])` | Account disconnect | No |
| `_internal/data/deleteSupabaseFileActionInternal.ts:89-92` | `.in("status", ["scheduled","processing"])` | Storage cleanup (folder) | No |
| `_internal/data/deleteSupabaseFileActionInternal.ts:205-208` | `.in("status", ["scheduled","processing"])` | Storage cleanup (single file) | No |
| `lib/mcp/tools/bulkSchedule.ts:164-170` | No status filter, `.gte/.lte` on `scheduled_at` | MCP quota check | Minimal: posted rows have past `scheduled_at` values outside the 24h forward window. Net effect: quotas become slightly more permissive (accurate). |
| `lib/mcp/tools/bulkSchedule.ts:329-335` | Upsert by idempotency_key | MCP bulk insert | No |
| `lib/mcp/tools/bulkSchedule.ts:364-368` | Fetch by idempotency_key | MCP idempotent lookup | No |
| `_internal/scheduleActions/schedulePost.ts:80-84` | Insert | Schedule new post | No |

## Every reference to status='posted'

| File:line | Type | Affected by removing posted rows? |
|---|---|---|
| `database.types.ts:225,257,287,665,697,727` | Type definition (generated) | No (type still valid, value unused in scheduled_posts) |
| `database.types.ts:1712` | `PostStatus` union type | No |
| `dbTypes.ts:45` | `PostStatus` union type | No |
| `_internal/scheduleActions/getScheduledPosts.ts:19` | Filter parameter type | No (filtering by "posted" returns empty) |
| `processSinglePostHelpers.ts:63` | Terminal state check (read) | No (row-not-found path has same outcome) |
| `processSinglePostHelpers.ts:482` | Write `status='posted'` | **YES: this is the line being REPLACED with DELETE** |
| `directPostForInstagramAccounts.ts:136` | Write `status: "posted"` to `content_history` | No (different table) |
| `tiktok/postVideo.ts:80` | Write `status: "posted"` to `content_history` | No (different table) |
| `tiktok/postImage.ts:83` | Write `status: "posted"` to `content_history` | No (different table) |
| `directPostForLinkedInAccounts.ts:193` | Write `status: "posted"` to `content_history` | No (different table) |
| `directPostForPinterestAccounts.ts:127` | Write `status: "posted"` to `content_history` | No (different table) |
| `listScheduledPosts.ts:27` | Zod enum for MCP filter | Dead value (filtering by "posted" returns empty) |
| `ContentHistoryCard.tsx:148` | UI badge color for `content_history` | No (different table) |
| `BatchedPostCard.tsx:105` | UI badge for `scheduled_posts` | Dead case (never hit after change) |
| `20260508000001_add_queued_status_to_scheduled_posts.sql:21,42` | CHECK constraint includes "posted" | No (constraint still valid, value just never written) |

## Retry flow (failed -> scheduled)

The codebase has NO automated retry path from `failed` to `scheduled`.

- Inngest's built-in retry: on retryable failures, the worker throws (`processSinglePost.ts:139-141`). Inngest retries with exponential backoff up to `RUNTIME.maxRetries`. During retries the row stays at `status='processing'`.
- `resumeScheduledPostBatch` (`_internal/scheduleActions/resumeScheduledPostBatch.ts:41`): resumes only `cancelled` rows, not `failed`.
- `updateScheduledTimeBatch` (`_internal/scheduleActions/updateScheduledTimeBatch.ts:50`): reschedules only `scheduled` or `cancelled` rows.
- A comment in `scheduledPostsTick.ts:38-40` mentions "a manual reschedule (status flipped back from failed to scheduled with a new scheduled_at)" but this is described as a hypothetical manual DB operation, not an automated flow.

The retry flow does NOT depend on posted rows existing.

## Storage cleanup

`src/actions/server/_internal/data/deleteSupabaseFileAction.ts`:

Reference check logic (single file, line 204-208):
```ts
const { count: scheduledCount, error: checkError } = await adminSupabase
    .from("scheduled_posts")
    .select("id", { count: "exact", head: true })
    .eq("media_storage_path", filePath)
    .in("status", ["scheduled", "processing"]);
```

The check filters to `["scheduled", "processing"]` only. It does NOT count `posted`, `failed`, or `cancelled` rows. Therefore, deleting a `posted` row has zero effect on the reference check.

The same filter appears for folder deletion at line 89-92.

Additionally, a separate `failed_posts` reference check exists (lines 221-225). It has no status filter. This is also unaffected by the change.

Step ordering context: `cleanup-storage` runs AFTER `record-status` in the worker. If `record-status` DELETEs the row (instead of setting status='posted'), `cleanup-storage` sees one fewer `scheduled_posts` reference. Since the reference check only looks at `scheduled/processing` statuses anyway, and the row was at `processing` (now deleted), the cleanup outcome is identical.

## MCP tools

| Tool | File | Status filter | Reads/writes posted? |
|---|---|---|---|
| `list_scheduled_posts` | `listScheduledPosts.ts` | Optional (`status` param, line 27). Default: none. | Currently reads posted rows when no filter or `status="posted"`. After change: returns empty for `status="posted"`. |
| `cancel_scheduled_posts` | `cancelScheduledPosts.ts` | Filters to `status="scheduled"` | No |
| `resume_scheduled_posts` | `resumeScheduledPosts.ts` | Filters to `status="cancelled"` | No |
| `reschedule_posts` | `reschedulePosts.ts` (via `updateScheduledTimeBatch`) | Filters to `"scheduled"/"cancelled"` | No |
| `delete_scheduled_posts` | `deleteScheduledPosts.ts` | No status filter (by ID) | Could delete posted rows; after change, posted rows are already gone. |
| `bulk_schedule` | `bulkSchedule.ts` | Quota check: no status filter, date range | Counts posted rows in quota window (minor; see readers table) |
| `schedule_post` | `schedulePost.ts` | Insert only | No |

MCP resource `scheduledPosts.ts:35`: calls `getScheduledPostsInternal(principalId, { limit: 100 })` with no status filter. Currently returns all statuses including posted. After the change, posted rows are absent. The resource returns a cleaner dataset.

## Database

`src/lib/types/database.types.ts:1708-1714`:
```ts
export type PostStatus =
  | "scheduled"
  | "queued"
  | "processing"
  | "posted"
  | "failed"
  | "cancelled";
```

CHECK constraint (`supabase/migrations/20260508000001_add_queued_status_to_scheduled_posts.sql:21`):
```sql
CHECK (status IN ('scheduled','queued','processing','posted','failed','cancelled'));
```

Partial indexes (same migration, lines 48-55):
```sql
CREATE INDEX idx_scheduled_posts_status_due
  ON public.scheduled_posts (status, scheduled_at)
  WHERE status IN ('scheduled','queued','processing');
```

The partial indexes do NOT cover `posted`, `failed`, or `cancelled`. These statuses are already "cold" data from the DB's perspective. Deleting posted rows removes cold data that isn't indexed, which is a net positive for table bloat.

### Foreign keys referencing scheduled_posts

`supabase/migrations/20260506000001_initial_schema.sql`:

- `content_history.scheduled_post_id` (line 401): `uuid NULL REFERENCES public.scheduled_posts(id) ON DELETE SET NULL`
- `x402_charges.scheduled_post_id` (line 544): `uuid NULL REFERENCES public.scheduled_posts(id) ON DELETE SET NULL`

Both columns are `NULL`able and use `ON DELETE SET NULL`. No application code ever writes to `content_history.scheduled_post_id` or `x402_charges.scheduled_post_id` (confirmed by grep: zero matches in `src/actions/` and `src/components/`; `storeContentHistory.ts` and `storeFailedPost.ts` do not set this field). The FK cascade would set NULL on an already-NULL column. No data loss.

## Posted page UI

Data source confirmed: `src/components/core/posted/renderPosts.tsx:1,9`:
```ts
import { getContentHistoryGroupedByBatch } from "@/actions/server/contentHistoryActions/getContentHistory";
const posts = await getContentHistoryGroupedByBatch(userId);
```

The Posted page reads from `content_history`, NOT from `scheduled_posts`. It is completely unaffected by the change.

## Risk assessment

| Risk | Severity | Evidence |
|---|---|---|
| Web scheduled page stops showing "Posted" badge cards | LOW | `getScheduledPostsInternal` returns all statuses (line 29, no default filter). Posted rows will be absent. The scheduled page becomes a view of only pending/active items. The Posted page (`content_history`) still shows the full history. This is arguably more correct behavior. |
| MCP `list_scheduled_posts` with `status="posted"` filter returns empty | LOW | `listScheduledPosts.ts:27` includes "posted" in the Zod enum. After the change, this filter always returns empty. Not breaking, but a dead filter value. |
| MCP resource `scheduled-posts` returns fewer items | LOW | `scheduledPosts.ts:35` has no status filter. Posted rows simply absent. Cleaner dataset. |
| `BatchedPostCard` "Posted" badge case becomes dead code | LOW | `BatchedPostCard.tsx:105-113`: the `case "posted"` branch in the status badge switch never executes. No runtime impact, just unreachable code. |
| `fetchPostAndAccount` terminal state list includes "posted" unnecessarily | LOW | `processSinglePostHelpers.ts:63`: `["posted", "failed", "cancelled"]`. After the change, a re-invocation of a successfully posted item hits the "not found" path (PGRST116) instead of the "already posted" path. Both return `skip: true`. Could simplify by removing "posted" from the list, but not required. |
| `content_history.scheduled_post_id` FK cascade fires | LOW | `ON DELETE SET NULL` on a column that is always NULL in practice (no code writes it). Cascade is a no-op. However, if future code starts writing this FK, the audit trail would be broken. |
| `bulkSchedule` quota count becomes slightly more permissive | LOW | `bulkSchedule.ts:164-170`: no status filter on the 24h window count. Posted rows with past `scheduled_at` are outside the `gte(now)` window anyway, so the impact is negligible. |
| `"posted"` value remains in PostStatus type and CHECK constraint | LOW | Both `database.types.ts:1712` and the SQL CHECK still include "posted". The value is valid but never written to `scheduled_posts`. No migration needed to remove it (and removing it would be a breaking schema change for no benefit). |

No BLOCKER or HIGH severity risks identified.

## Open questions for the user

1. Should the `BatchedPostCard` "Posted" badge case (line 105) be removed as dead code in the same PR, or left for a separate cleanup?
2. Should the `"posted"` value be removed from the MCP `list_scheduled_posts` Zod schema (`listScheduledPosts.ts:27`), or left for backwards compatibility?
3. Is there any external system (dashboard, Supabase SQL editor queries, analytics tooling, Retool, etc.) that queries `scheduled_posts WHERE status = 'posted'`? The codebase cannot answer this.
4. Should `"posted"` be removed from the `terminalStates` array in `fetchPostAndAccount` (`processSinglePostHelpers.ts:63`), or left as defensive dead code?
5. Should the `content_history.scheduled_post_id` and `x402_charges.scheduled_post_id` columns be populated before this change ships, so the FK provides a useful audit trail? Currently no code writes to these columns, so the FK exists but carries no data. If the user wants to trace content_history back to the original scheduled_post, the code must write `scheduled_post_id` at storeContentHistory time (in the directPost functions), and the DELETE must happen AFTER that write completes.

## Files read for this recon

```
src/actions/server/_internal/data/deleteSupabaseFileAction.ts
src/actions/server/_internal/scheduleActions/cancelScheduledPostBatch.ts
src/actions/server/_internal/scheduleActions/deleteScheduledPostBatch.ts
src/actions/server/_internal/scheduleActions/getScheduledPosts.ts
src/actions/server/_internal/scheduleActions/resumeScheduledPostBatch.ts
src/actions/server/_internal/scheduleActions/schedulePost.ts
src/actions/server/_internal/scheduleActions/updateScheduledTimeBatch.ts
src/actions/server/accounts/disconnectSocialAccount.ts
src/actions/server/contentHistoryActions/storeContentHistory.ts (grep only)
src/actions/server/contentHistoryActions/storeFailedPost.ts (grep only)
src/actions/server/scheduleActions/deleteScheduledPost.ts
src/actions/server/scheduleActions/getScheduledPosts.ts
src/app/(protected)/posted/page.tsx
src/app/(protected)/scheduled/page.tsx
src/components/core/posted/ContentHistoryCard.tsx
src/components/core/posted/renderPosts.tsx
src/components/core/scheduled/BatchedPostCard.tsx
src/components/core/scheduled/PostsGrid.tsx
src/inngest/functions/platformErrors.ts
src/inngest/functions/processSinglePost.ts
src/inngest/functions/processSinglePostHelpers.ts
src/inngest/functions/scheduledPostsTick.ts
src/inngest/functions/scheduledPostsTickHelpers.ts
src/lib/api/instagram/post/directPostForInstagramAccounts.ts
src/lib/api/linkedin/post/directPostForLinkedInAccounts.ts
src/lib/api/pinterest/post/directPostForPinterestAccounts.ts
src/lib/api/tiktok/post/postImage.ts (grep only)
src/lib/api/tiktok/post/postVideo.ts (grep only)
src/lib/mcp/resources/scheduledPosts.ts
src/lib/mcp/tools/bulkSchedule.ts
src/lib/mcp/tools/listScheduledPosts.ts
src/lib/types/database.types.ts
src/lib/types/dbTypes.ts
supabase/migrations/20260506000001_initial_schema.sql
supabase/migrations/20260508000001_add_queued_status_to_scheduled_posts.sql
```

## Greps run

```
grep -rn "deleteScheduledPost" src --include="*.ts"                    # 17 matches
grep -rn ".from(\"scheduled_posts\")" src --include="*.ts"             # 25 matches
grep -rn "['\"']posted['\"']" src --include="*.ts" --include="*.tsx"   # 20 matches
grep -rn "retry_count|retryCount" src --include="*.ts"                 # 10 matches
grep -rn "scheduled_post_id" src --include="*.ts"                      # 15 matches
grep -rn "scheduled_post_id" src/actions/ --include="*.ts"             # 0 matches
grep -rn "scheduled_post_id" src/components/ --include="*.tsx"         # 0 matches
grep -rn "storeContentHistory|storeFailedPost" src --include="*.ts"    # 7 files matched
grep -rn "scheduled_post_id" storeContentHistory.ts                    # 0 matches
grep -rn "scheduled_post_id" storeFailedPost.ts                       # 0 matches
grep -rn "content_history|getContentHistory" posted/                   # 0 matches (page.tsx)
grep -rn "getContentHistory" src --include="*.ts" --include="*.tsx"    # 20 matches
grep -rn "post_status|CHECK.*status" supabase/migrations/             # 8 matches
grep -rn "scheduledPosts|scheduled_posts" src/lib/mcp/resources/       # 5 matches
grep -rn "REFERENCES.*scheduled_posts" supabase/migrations/           # 2 matches
```
