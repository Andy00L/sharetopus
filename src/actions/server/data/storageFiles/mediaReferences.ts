import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { union } from "drizzle-orm/pg-core";

import { db, runQuery } from "@/db/client";
import {
  failed_posts,
  pending_direct_posts,
  pending_tiktok_pulls,
  scheduled_posts,
} from "@/db/schema";
import type { PostStatus } from "@/db/schema";

/**
 * Which rows keep a media file alive:
 *   - "in_use": a scheduled post that can still publish or be resumed
 *     (scheduled, queued, processing, cancelled), any failed_posts row, a
 *     TikTok pull still pending, a direct post still processing. The test
 *     every user-facing delete and post-publish cleanup runs.
 *   - "any_row": every row of the four tables, whatever its status. The
 *     orphan sweep's test: it deletes only files nothing mentions.
 */
export type MediaReferenceScope = "in_use" | "any_row";

/**
 * Scheduled-post statuses whose media must stay. queued sits between the
 * tick and the worker's claim; cancelled posts come back through resume and
 * reschedule. Leaving either out let the first post of a fan-out delete the
 * file its siblings still needed.
 */
const MEDIA_HOLDING_POST_STATUSES: PostStatus[] = [
  "scheduled",
  "queued",
  "processing",
  "cancelled",
];

/** Paths per statement. Each path is bound once per table: 4 x 250 = 1000 parameters. */
const PATHS_PER_STATEMENT = 250;

export type ReferencedMediaPathsResult =
  | { success: true; referenced: Set<string> }
  | { success: false; message: string };

/**
 * The subset of `paths` some row still references, one UNION statement per
 * PATHS_PER_STATEMENT paths instead of one query per table and path.
 *
 * Whatever this misses gets deleted by the caller, so any failed statement
 * fails the whole call and the caller keeps every file.
 */
export async function findReferencedMediaPaths(
  paths: string[],
  scope: MediaReferenceScope,
): Promise<ReferencedMediaPathsResult> {
  const referenced = new Set<string>();
  const uniquePaths = [...new Set(paths)];

  for (
    let chunkStart = 0;
    chunkStart < uniquePaths.length;
    chunkStart += PATHS_PER_STATEMENT
  ) {
    const chunk = uniquePaths.slice(chunkStart, chunkStart + PATHS_PER_STATEMENT);
    const { data: referenceRows, error } = await runQuery(
      buildReferenceQuery(chunk, scope),
    );
    if (error) {
      return {
        success: false,
        message: `Media reference check failed: ${error.message}`,
      };
    }
    for (const referenceRow of referenceRows) {
      referenced.add(referenceRow.media_storage_path);
    }
  }

  return { success: true, referenced };
}

function buildReferenceQuery(chunk: string[], scope: MediaReferenceScope) {
  const isInUseScope = scope === "in_use";
  return union(
    db
      .select({ media_storage_path: scheduled_posts.media_storage_path })
      .from(scheduled_posts)
      .where(
        and(
          inArray(scheduled_posts.media_storage_path, chunk),
          isInUseScope
            ? inArray(scheduled_posts.status, MEDIA_HOLDING_POST_STATUSES)
            : undefined,
        ),
      ),
    db
      .select({ media_storage_path: failed_posts.media_storage_path })
      .from(failed_posts)
      .where(inArray(failed_posts.media_storage_path, chunk)),
    db
      .select({ media_storage_path: pending_tiktok_pulls.media_storage_path })
      .from(pending_tiktok_pulls)
      .where(
        and(
          inArray(pending_tiktok_pulls.media_storage_path, chunk),
          isInUseScope ? eq(pending_tiktok_pulls.status, "pending") : undefined,
        ),
      ),
    db
      .select({ media_storage_path: pending_direct_posts.media_storage_path })
      .from(pending_direct_posts)
      .where(
        and(
          inArray(pending_direct_posts.media_storage_path, chunk),
          isInUseScope
            ? eq(pending_direct_posts.status, "processing")
            : undefined,
        ),
      ),
  );
}
