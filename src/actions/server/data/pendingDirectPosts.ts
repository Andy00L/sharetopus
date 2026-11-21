import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { pending_direct_posts } from "@/db/schema";
import type { Platform } from "@/db/schema";
import "server-only";

export type PendingDirectPostLock = {
  event_id: string;
  batch_id: string;
  principal_id: string;
  social_account_id: string;
  platform: Platform;
  media_storage_path: string;
  idempotency_key: string | null;
};

type ExistingDirectPostLock = Pick<PendingDirectPostLock, "event_id" | "batch_id">;

type DirectPostLockEntry<Item> =
  | { kind: "locked"; item: Item }
  | { kind: "already_locked"; item: Item; existingLock: ExistingDirectPostLock };

type LockPendingDirectPostsResult<Item> =
  | { success: true; entries: DirectPostLockEntry<Item>[] }
  | { success: false; message: string };

type LockCandidate<Item> = { item: Item; lock: PendingDirectPostLock };

export async function lockPendingDirectPosts<Item>(
  items: Item[],
  toLock: (item: Item) => PendingDirectPostLock,
): Promise<LockPendingDirectPostsResult<Item>> {
  const candidates = items.map((item): LockCandidate<Item> => ({ item, lock: toLock(item) }));
  if (candidates.length === 0) return { success: true, entries: [] };

  const { data: insertedRows, error } = await runQuery(
    db
      .insert(pending_direct_posts)
      .values(candidates.map((candidate) => ({ ...candidate.lock, status: "processing" as const })))
      .onConflictDoNothing()
      .returning({ event_id: pending_direct_posts.event_id }),
  );
  if (error) {
    console.error("[lockPendingDirectPosts] Insert failed:", error.message);
    return { success: false, message: `Insert failed: ${error.message}` };
  }

  const insertedEventIds = insertedRows.map((insertedRow) => insertedRow.event_id);
  const insertedEventIdSet = new Set(insertedEventIds);
  const skippedLocks = candidates
    .map((candidate) => candidate.lock)
    .filter((lock) => !insertedEventIdSet.has(lock.event_id));
  console.log(
    `[lockPendingDirectPosts] Inserted ${insertedEventIds.length} lock row(s), ${skippedLocks.length} already existed`,
  );

  const existing =
    skippedLocks.length > 0
      ? await findLocksByIdempotencyKey(skippedLocks)
      : { success: true as const, lockByKey: new Map<string, ExistingDirectPostLock>() };
  if (!existing.success) {
    return failAfterReleasing(insertedEventIds, existing.message);
  }

  const entries: DirectPostLockEntry<Item>[] = [];
  for (const candidate of candidates) {
    if (insertedEventIdSet.has(candidate.lock.event_id)) {
      entries.push({ kind: "locked", item: candidate.item });
      continue;
    }
    const existingLock = existing.lockByKey.get(toIdempotencyMapKey(candidate.lock));
    if (!existingLock) {
      return failAfterReleasing(
        insertedEventIds,
        `Lock for event ${candidate.lock.event_id} was neither written nor found by idempotency key`,
      );
    }
    entries.push({ kind: "already_locked", item: candidate.item, existingLock });
  }
  return { success: true, entries };
}

function toIdempotencyMapKey(lock: Pick<PendingDirectPostLock, "principal_id" | "idempotency_key">): string {
  return JSON.stringify([lock.principal_id, lock.idempotency_key]);
}

async function findLocksByIdempotencyKey(
  locks: PendingDirectPostLock[],
): Promise<
  | { success: true; lockByKey: Map<string, ExistingDirectPostLock> }
  | { success: false; message: string }
> {
  const keyedLockFilters = locks.flatMap((lock) =>
    lock.idempotency_key === null
      ? []
      : [
          and(
            eq(pending_direct_posts.principal_id, lock.principal_id),
            eq(pending_direct_posts.idempotency_key, lock.idempotency_key),
          ),
        ],
  );
  if (keyedLockFilters.length === 0) return { success: true, lockByKey: new Map() };

  const { data: existingRows, error } = await runQuery(
    db
      .select({
        event_id: pending_direct_posts.event_id,
        batch_id: pending_direct_posts.batch_id,
        principal_id: pending_direct_posts.principal_id,
        idempotency_key: pending_direct_posts.idempotency_key,
      })
      .from(pending_direct_posts)
      .where(or(...keyedLockFilters)),
  );
  if (error) {
    console.error("[findLocksByIdempotencyKey] Lookup failed:", error.message);
    return { success: false, message: `Existing lock lookup failed: ${error.message}` };
  }
  return {
    success: true,
    lockByKey: new Map(
      existingRows.map((existingRow) => [
        toIdempotencyMapKey(existingRow),
        { event_id: existingRow.event_id, batch_id: existingRow.batch_id },
      ]),
    ),
  };
}

async function failAfterReleasing(
  insertedEventIds: string[],
  message: string,
): Promise<{ success: false; message: string }> {
  const released = await releasePendingDirectPosts(insertedEventIds);
  return {
    success: false,
    message: released.success ? message : `${message}; ${released.message}`,
  };
}

type ReleasePendingDirectPostsResult =
  | { success: true; releasedCount: number }
  | { success: false; message: string };

export async function releasePendingDirectPosts(
  eventIds: string[],
): Promise<ReleasePendingDirectPostsResult> {
  if (eventIds.length === 0) return { success: true, releasedCount: 0 };

  const { data: releasedRows, error } = await runQuery(
    db
      .delete(pending_direct_posts)
      .where(
        and(
          inArray(pending_direct_posts.event_id, eventIds),
          eq(pending_direct_posts.status, "processing"),
          isNull(pending_direct_posts.publish_started_at),
        ),
      )
      .returning({ event_id: pending_direct_posts.event_id }),
  );
  if (error) {
    console.error(
      `[releasePendingDirectPosts] Could not release ${eventIds.length} unsent lock row(s):`,
      error.message,
    );
    return { success: false, message: `Lock release failed: ${error.message}` };
  }
  console.log(`[releasePendingDirectPosts] Released ${releasedRows.length} unsent lock row(s)`);
  return { success: true, releasedCount: releasedRows.length };
}

export type DirectPostLockRow = Pick<
  typeof pending_direct_posts.$inferSelect,
  "batch_id" | "social_account_id" | "platform" | "status" | "created_at"
>;

export async function readDirectPostLock(
  eventId: string,
): Promise<{ success: true; lock: DirectPostLockRow | null } | { success: false; message: string }> {
  const { data: lockRows, error } = await runQuery(
    db
      .select({
        batch_id: pending_direct_posts.batch_id,
        social_account_id: pending_direct_posts.social_account_id,
        platform: pending_direct_posts.platform,
        status: pending_direct_posts.status,
        created_at: pending_direct_posts.created_at,
      })
      .from(pending_direct_posts)
      .where(eq(pending_direct_posts.event_id, eventId))
      .limit(1),
  );
  if (error) {
    console.error(`[readDirectPostLock] Lookup of ${eventId} failed:`, error.message);
    return { success: false, message: `Lock lookup failed: ${error.message}` };
  }
  return { success: true, lock: lockRows[0] ?? null };
}

const FAILURE_REASON_MAX_CHARS = 1000;

const STALE_WORKER_SWEPT_REASON = "stale_worker_swept";

export type DirectPostOutcome =
  | { status: "completed" }
  | { status: "failed"; failureReason: string };

type FinalizePendingDirectPostResult =
  | { success: true; updated: boolean }
  | { success: false; message: string };

export async function finalizePendingDirectPost(input: {
  eventId: string;
  outcome: DirectPostOutcome;
}): Promise<FinalizePendingDirectPostResult> {
  const { eventId, outcome } = input;

  const { data: updatedRows, error } = await runQuery(
    db
      .update(pending_direct_posts)
      .set({
        status: outcome.status,
        finished_at: new Date().toISOString(),
        failure_reason:
          outcome.status === "failed"
            ? outcome.failureReason.slice(0, FAILURE_REASON_MAX_CHARS)
            : null,
      })
      .where(
        and(
          eq(pending_direct_posts.event_id, eventId),
          or(
            eq(pending_direct_posts.status, "processing"),
            and(
              eq(pending_direct_posts.status, "failed"),
              eq(pending_direct_posts.failure_reason, STALE_WORKER_SWEPT_REASON),
            ),
          ),
        ),
      )
      .returning({ event_id: pending_direct_posts.event_id }),
  );

  if (error) {
    console.error("[finalizePendingDirectPost] Update failed:", error.message);
    return { success: false, message: `Update failed: ${error.message}` };
  }

  const updated = updatedRows.length > 0;
  console.log(
    updated
      ? `[finalizePendingDirectPost] Marked ${outcome.status}: ${eventId}`
      : `[finalizePendingDirectPost] Already finalized: ${eventId}`,
  );
  return { success: true, updated };
}

export async function sweepStuckPendingDirectPosts(
  cutoffIso: string,
): Promise<
  { success: true; sweptCount: number } | { success: false; message: string }
> {
  const now = new Date().toISOString();

  const { data: sweptRows, error } = await runQuery(
    db
      .update(pending_direct_posts)
      .set({
        status: "failed" as const,
        finished_at: now,
        failure_reason: STALE_WORKER_SWEPT_REASON,
      })
      .where(
        and(
          eq(pending_direct_posts.status, "processing"),
          lt(pending_direct_posts.created_at, cutoffIso),
          or(
            isNull(pending_direct_posts.publish_started_at),
            lt(pending_direct_posts.publish_started_at, cutoffIso),
          ),
        ),
      )
      .returning({ event_id: pending_direct_posts.event_id }),
  );

  if (error) {
    console.error(
      "[sweepStuckPendingDirectPosts] Update failed:",
      error.message,
    );
    return { success: false, message: `Sweep failed: ${error.message}` };
  }

  return { success: true, sweptCount: sweptRows.length };
}
