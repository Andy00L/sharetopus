import "server-only";

import { and, eq, gte, isNull, sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { content_history, pending_direct_posts } from "@/db/schema";
import type { PostNowEventData } from "@/inngest/events/postNow";
import type { PublishedCheckResult } from "@/inngest/functions/processSinglePostHelpers";
import type {
  PublishMediaUrls,
  PublishRequest,
} from "@/inngest/functions/publishToPlatform";
import type { SocialAccount } from "@/lib/types/dbTypes";

type DirectDispatch = Pick<
  typeof pending_direct_posts.$inferSelect,
  "batch_id" | "social_account_id" | "platform" | "status" | "created_at" | "publish_started_at"
>;

type DirectDispatchRead =
  | { success: true; dispatch: DirectDispatch | null }
  | { success: false; message: string };

export async function readDirectDispatch(dispatchId: string): Promise<DirectDispatchRead> {
  const { data: dispatchRows, error } = await runQuery(
    db
      .select({
        batch_id: pending_direct_posts.batch_id,
        social_account_id: pending_direct_posts.social_account_id,
        platform: pending_direct_posts.platform,
        status: pending_direct_posts.status,
        created_at: pending_direct_posts.created_at,
        publish_started_at: pending_direct_posts.publish_started_at,
      })
      .from(pending_direct_posts)
      .where(eq(pending_direct_posts.event_id, dispatchId))
      .limit(1),
  );
  if (error) {
    console.error(`[readDirectDispatch] Lookup of ${dispatchId} failed:`, error.message);
    return { success: false, message: `dispatch lookup failed: ${error.message}` };
  }
  return { success: true, dispatch: dispatchRows[0] ?? null };
}

export type DirectPublishBlock =
  | "dispatch-gone"
  | "already-published"
  | "attempt-already-started"
  | "already-failed";

type DirectPublishClaim =
  | { success: true; kind: "claimed" | DirectPublishBlock }
  | { success: false; message: string };

function findDirectPublishBlock(
  dispatch: Pick<DirectDispatch, "status" | "publish_started_at"> | null,
): DirectPublishBlock | null {
  if (dispatch === null) return "dispatch-gone";
  if (dispatch.status === "completed") return "already-published";
  if (dispatch.publish_started_at !== null) return "attempt-already-started";
  if (dispatch.status === "failed") return "already-failed";
  return null;
}

export async function claimDirectPublishAttempt(dispatchId: string): Promise<DirectPublishClaim> {
  const { data: claimedRows, error } = await runQuery(
    db
      .update(pending_direct_posts)
      .set({ publish_started_at: new Date().toISOString() })
      .where(
        and(
          eq(pending_direct_posts.event_id, dispatchId),
          eq(pending_direct_posts.status, "processing"),
          isNull(pending_direct_posts.publish_started_at),
        ),
      )
      .returning({ event_id: pending_direct_posts.event_id }),
  );
  if (error) {
    console.error(`[claimDirectPublishAttempt] Claim of ${dispatchId} failed:`, error.message);
    return { success: false, message: `publish claim failed: ${error.message}` };
  }
  if (claimedRows.length > 0) return { success: true, kind: "claimed" };

  const current = await readDirectDispatch(dispatchId);
  if (!current.success) return current;
  const block = findDirectPublishBlock(current.dispatch);
  if (block === null) {
    return {
      success: false,
      message: `publish claim of ${dispatchId} matched no row, but the dispatch reads processing and unclaimed`,
    };
  }
  return { success: true, kind: block };
}

type DirectPublishRelease = { success: true } | { success: false; message: string };

export async function releaseDirectPublishAttempt(dispatchId: string): Promise<DirectPublishRelease> {
  const { error } = await runQuery(
    db
      .update(pending_direct_posts)
      .set({ publish_started_at: null })
      .where(eq(pending_direct_posts.event_id, dispatchId)),
  );
  if (error) {
    console.error(`[releaseDirectPublishAttempt] Release of ${dispatchId} failed:`, error.message);
    return { success: false, message: `publish release failed: ${error.message}` };
  }
  return { success: true };
}

export async function findPublishedDirectPost(input: {
  dispatch: Pick<DirectDispatch, "batch_id" | "social_account_id" | "platform" | "created_at">;
  description: string;
}): Promise<PublishedCheckResult> {
  const { dispatch, description } = input;
  const { data, error } = await runQuery(
    db
      .select({ id: content_history.id })
      .from(content_history)
      .where(
        and(
          eq(content_history.batch_id, dispatch.batch_id),
          eq(content_history.social_account_id, dispatch.social_account_id),
          eq(content_history.platform, dispatch.platform),
          isNull(content_history.scheduled_post_id),
          gte(content_history.created_at, dispatch.created_at),
          eq(sql`coalesce(${content_history.description}, '')`, description),
        ),
      )
      .limit(1),
  );
  if (error) {
    return { success: false, message: `content history lookup failed: ${error.message}` };
  }
  return { success: true, isPublished: data.length > 0 };
}

export function buildDirectPublishRequest(input: {
  data: PostNowEventData;
  account: SocialAccount;
  urls: PublishMediaUrls;
}): PublishRequest {
  const { data, account, urls } = input;
  return {
    account,
    principalId: data.principal_id,
    platform: data.platform,
    postType: data.post_type,
    title: data.account_content.title,
    description: data.account_content.description,
    link: data.account_content.link,
    platformOptions: data.platform_options,
    pinterestBoard: data.board
      ? { boardId: data.board.boardID, boardName: data.board.boardName }
      : null,
    registryOptions: data.post_options ?? {},
    coverTimestampMs: data.cover_timestamp,
    media: { storagePath: data.media_path, urls },
    batchId: data.batch_id,
    origin: { kind: "post_now", dispatchId: data.dispatch_id },
    createdVia: data.created_via,
  };
}
