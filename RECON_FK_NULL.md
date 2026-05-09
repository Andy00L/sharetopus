# Recon: content_history.scheduled_post_id NULL after FIX 15

Date: 2026-05-08
Branch: main
HEAD commit: 74e7df0 fix(scheduled): delete on success + populate content_history lineage (FIX 15)

## Executive summary

FIX 15 code is correct: every platform's `directPostFor*` function passes
`scheduled_post_id` to `storeContentHistory`, and the INSERT succeeds.

The value is then immediately erased by the database itself. The FK constraint
on `content_history.scheduled_post_id` is defined as `ON DELETE SET NULL`
(migration line 401). When the worker's `recordPostStatus` step deletes the
`scheduled_posts` row on success (processSinglePostHelpers.ts:484-489),
PostgreSQL cascades that delete as a SET NULL on every `content_history` row
that referenced it. The write and the erase happen in the same worker
invocation, seconds apart.

## FIX 15 code is present at HEAD

`storeContentHistory.ts:17` -- input type has `scheduled_post_id?: string | null`
`storeContentHistory.ts:61` -- INSERT object includes `scheduled_post_id: data.scheduled_post_id ?? null`
`processSinglePostHelpers.ts:357,374,392,412` -- all 4 platform calls pass `scheduledPostId: post.id`

All 4 `directPostFor*` files accept `scheduledPostId` and forward it as `scheduled_post_id`:
- `directPostForPinterestAccounts.ts:40` (accepts), `:128` (forwards)
- `directPostForLinkedInAccounts.ts:33` (accepts), `:193` (forwards)
- `directPostForTikTokAccounts.ts:34` (accepts), `:123` (forwards)
- `directPostForInstagramAccounts.ts:32` (accepts), `:137` (forwards)

## Every caller of storeContentHistory

| File:line | Type | Receives scheduledPostId? | Forwards to storeContentHistory? | Status |
|---|---|---|---|---|
| storeContentHistory.ts:24 | def | n/a | n/a | Definition |
| storeContentHistory.ts:1 | comment | n/a | n/a | Comment |
| directPostForPinterestAccounts.ts:2 | import | n/a | n/a | Import |
| directPostForPinterestAccounts.ts:119 | call | Yes (config.scheduledPostId, line 40) | Yes (line 128) | OK |
| directPostForLinkedInAccounts.ts:3 | import | n/a | n/a | Import |
| directPostForLinkedInAccounts.ts:185 | call | Yes (config.scheduledPostId, line 33) | Yes (line 193) | OK |
| directPostForTikTokAccounts.ts:2 | import | n/a | n/a | Import |
| directPostForTikTokAccounts.ts:114 | call | Yes (config.scheduledPostId, line 34) | Yes (line 123) | OK |
| directPostForInstagramAccounts.ts:2 | import | n/a | n/a | Import |
| directPostForInstagramAccounts.ts:128 | call | Yes (config.scheduledPostId, line 32) | Yes (line 137) | OK |
| processSinglePostHelpers.ts:427 | comment | n/a | n/a | Comment only |

No helper file (postToPinterest, postImage, createVideoPin, postToLinkedIn,
postToTikTok, postVideo, postImage, postToInstagram) calls `storeContentHistory`
or performs direct `content_history` inserts. All writes flow through the
`directPostFor*` layer exclusively.

## Per-platform call chain trace

### Pinterest

```
processSinglePostHelpers.ts:285 callPlatformDirectPost(args)
  args.post = ScheduledPost (has .id)
  :329 switch(post.platform) -> case "pinterest" :330
    :338 directPostForPinterestAccounts({...scheduledPostId: post.id}) :357
      -> directPostForPinterestAccounts.ts:14
        :42-54 destructures config (scheduledPostId NOT destructured)
        :94 postToPinterest({...}) -- no scheduledPostId needed here
        :117 if (postResult.success)
          :119 storeContentHistory({...scheduled_post_id: config.scheduledPostId ?? null}, userId) :128
            -> storeContentHistory.ts:24
              :51-64 builds insertData with scheduled_post_id: data.scheduled_post_id ?? null :61
              :67-71 adminSupabase.from("content_history").insert(insertData) :68-69
              -- INSERT succeeds. content_history.scheduled_post_id = post.id
  :425-428 returns ok:true
-- Worker next step:
processSinglePostHelpers.ts:475 recordPostStatus(args)
  :483 if (result.ok)
    :484-489 adminSupabase.from("scheduled_posts").delete().eq("id", post.id)
    -- FK cascade: ON DELETE SET NULL nulls content_history.scheduled_post_id
```

scheduledPostId is in scope and forwarded at every hop. The chain breaks at the
DB level, not at the application level.

### LinkedIn

```
processSinglePostHelpers.ts:362 directPostForLinkedInAccounts({...scheduledPostId: post.id}) :374
  -> directPostForLinkedInAccounts.ts:52
    :55-65 destructures config (scheduledPostId NOT destructured)
    :159 postToLinkedIn({...}) -- no scheduledPostId
    :184 if (postResult.success)
      :185 storeContentHistory({...scheduled_post_id: config.scheduledPostId ?? null}, userId) :193
        -> storeContentHistory.ts:68 INSERT
-- Same FK cascade applies on recordPostStatus delete
```

### TikTok

```
processSinglePostHelpers.ts:379 directPostForTikTokAccounts({...scheduledPostId: post.id}) :392
  -> directPostForTikTokAccounts.ts:15
    :36-47 destructures config (scheduledPostId NOT destructured)
    :91 postToTikTok({...}) -- no scheduledPostId
    :112 if (postResult.success)
      :114 storeContentHistory({...scheduled_post_id: config.scheduledPostId ?? null}, userId) :123
        -> storeContentHistory.ts:68 INSERT
-- Same FK cascade applies on recordPostStatus delete
```

### Instagram

```
processSinglePostHelpers.ts:400 directPostForInstagramAccounts({...scheduledPostId: post.id}) :412
  -> directPostForInstagramAccounts.ts:15
    :34-44 destructures config (scheduledPostId NOT destructured)
    :104 postToInstagram({...}) -- no scheduledPostId
    :126 if (postResult.success)
      :128 storeContentHistory({...scheduled_post_id: config.scheduledPostId ?? null}, userId) :137
        -> storeContentHistory.ts:68 INSERT
-- Same FK cascade applies on recordPostStatus delete
```

## storeContentHistory implementation

File: `src/actions/server/contentHistoryActions/storeContentHistory.ts`

Input type (lines 7-19):
```typescript
export type StoreContentHistoryInput = {
  // ...
  scheduled_post_id?: string | null;   // line 17
  // ...
};
```

INSERT object (lines 51-64):
```typescript
const insertData: TablesInsert<"content_history"> = {
  // ...
  scheduled_post_id: data.scheduled_post_id ?? null,   // line 61
  // ...
};
```

DB call (lines 67-71):
```typescript
const { data: newRecord, error } = await adminSupabase
  .from("content_history")
  .insert(insertData)
  .select("id")
  .single();
```

The function correctly accepts and writes `scheduled_post_id`. No typos, no
destructuring miss, no key mismatch.

## Database type confirmation

File: `src/lib/types/database.types.ts`

`content_history.Row` (line 142): `scheduled_post_id: string | null`
`content_history.Insert` (line 159): `scheduled_post_id?: string | null`

The generated type allows the column. The Supabase client will not strip it.

## FK constraint (the root cause)

File: `supabase/migrations/20260506000001_initial_schema.sql`

Line 401:
```sql
scheduled_post_id  uuid NULL REFERENCES public.scheduled_posts(id) ON DELETE SET NULL,
```

This FK means: when a `scheduled_posts` row is deleted, PostgreSQL sets
`content_history.scheduled_post_id` to NULL on every `content_history` row that
referenced that `scheduled_posts.id`.

The `recordPostStatus` function (processSinglePostHelpers.ts:483-489) deletes
the `scheduled_posts` row on success:
```typescript
if (result.ok) {
    const { data, error } = await adminSupabase
      .from("scheduled_posts")
      .delete()
      .eq("id", post.id)
      .eq("status", "processing" satisfies PostStatus)
      .select("id");
```

Neither of the later migrations (20260507, 20260508) modify this FK constraint.

## Diagnosis

FIX 15 is complete at the application layer: all 4 platforms correctly write
`scheduled_post_id` into `content_history` via `storeContentHistory`.

The value is then erased by the FK cascade. The worker sequence is:

1. `callPlatformDirectPost` -> `directPostFor*` -> `storeContentHistory` writes
   `content_history.scheduled_post_id = post.id`
2. `recordPostStatus` deletes `scheduled_posts` row where `id = post.id`
3. PostgreSQL FK `ON DELETE SET NULL` sets `content_history.scheduled_post_id = NULL`

The write and the erase happen in the same worker invocation. This affects ALL
platforms equally, not just one.

## Operator must confirm

Run these queries in the Supabase SQL editor to validate the diagnosis:

```sql
-- 1. Check most recent content_history rows for any non-NULL scheduled_post_id.
--    If the diagnosis is correct, ALL scheduled_post_id values will be NULL
--    regardless of whether the post was scheduled or manual.
SELECT id, scheduled_post_id, platform, status, batch_id, created_at
FROM content_history
ORDER BY created_at DESC
LIMIT 20;
```

```sql
-- 2. Cross-check: are there ANY scheduled_posts rows still alive?
--    If FIX 15's delete-on-success is working, successfully posted rows
--    will be gone. Only 'failed', 'scheduled', or 'processing' rows remain.
SELECT id, status, platform, scheduled_at, created_at
FROM scheduled_posts
ORDER BY created_at DESC
LIMIT 10;
```

```sql
-- 3. Verify the FK constraint behavior directly.
SELECT
  tc.constraint_name,
  rc.delete_rule,
  rc.update_rule
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.table_name = 'content_history'
  AND tc.constraint_type = 'FOREIGN KEY'
  AND tc.constraint_name LIKE '%scheduled_post%';
```

The operator should confirm:
- Which platform was tested
- Whether the test post was created via "Schedule" UI (scheduled worker path)
  or "Post Now" UI (direct web path -- does not create a scheduled_posts row,
  so scheduled_post_id is expected to be NULL by design)
- The timestamp of the test post vs. the FIX 15 deploy timestamp

## Open questions

1. Was the intent to preserve `scheduled_post_id` as a historical reference
   after the scheduled_posts row is deleted? If so, the FK's ON DELETE behavior
   must change (e.g., to `ON DELETE NO ACTION` with the FK dropped entirely, or
   the column stored as a plain uuid without referential integrity).
2. Alternatively, should `recordPostStatus` soft-delete (status update) instead
   of hard-delete? This would preserve the FK but keep the scheduled_posts row.
3. The `x402_charges` table has the same pattern: `scheduled_post_id uuid NULL
   REFERENCES public.scheduled_posts(id) ON DELETE SET NULL` (migration line
   544). If the FK behavior changes for content_history, x402_charges should be
   reviewed for the same issue.
