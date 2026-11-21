import "server-only";

import { and, eq, inArray, ne, notExists, or } from "drizzle-orm";
import { union } from "drizzle-orm/pg-core";

import { db, runQuery } from "@/db/client";
import {
  failed_posts,
  pending_direct_posts,
  pending_tiktok_pulls,
  scheduled_posts,
} from "@/db/schema";
import type { PostStatus } from "@/db/schema";

export type MediaReferenceScope = "in_use" | "any_row";

const MEDIA_HOLDING_POST_STATUSES: PostStatus[] = [
  "scheduled",
  "queued",
  "processing",
  "cancelled",
];

const PATHS_PER_STATEMENT = 250;

export type ReferencedMediaPathsResult =
  | { success: true; referenced: Set<string> }
  | { success: false; message: string };

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
            ? or(
                inArray(scheduled_posts.status, MEDIA_HOLDING_POST_STATUSES),
                isPostedTikTokPostAwaitingPull(),
              )
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

function isPostedTikTokPostAwaitingPull() {
  return and(
    eq(scheduled_posts.platform, "tiktok"),
    eq(scheduled_posts.status, "posted"),
    notExists(
      db
        .select({ publish_id: pending_tiktok_pulls.publish_id })
        .from(pending_tiktok_pulls)
        .where(
          and(
            eq(pending_tiktok_pulls.scheduled_post_id, scheduled_posts.id),
            ne(pending_tiktok_pulls.status, "pending"),
          ),
        ),
    ),
  );
}
