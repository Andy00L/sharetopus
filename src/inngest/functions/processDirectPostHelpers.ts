import "server-only";

import { and, eq, gte, isNull, sql } from "drizzle-orm";

import type { DirectPostLockRow } from "@/actions/server/data/pendingDirectPosts";
import { db, runQuery } from "@/db/client";
import { content_history } from "@/db/schema";
import type { PostNowEventData } from "@/inngest/events/postNow";
import type { PublishedCheckResult } from "@/inngest/functions/processSinglePostHelpers";
import type {
  PublishMediaUrls,
  PublishRequest,
} from "@/inngest/functions/publishToPlatform";
import type { SocialAccount } from "@/lib/types/dbTypes";

export type DirectPostResult = {
  success: boolean;
  message: string | null;
  contentId: string | null;
  mayHavePublished: boolean;
};

export async function findPublishedDirectPost(input: {
  lock: Pick<DirectPostLockRow, "batch_id" | "social_account_id" | "platform" | "created_at">;
  description: string;
}): Promise<PublishedCheckResult> {
  const { lock, description } = input;
  const { data, error } = await runQuery(
    db
      .select({ id: content_history.id })
      .from(content_history)
      .where(
        and(
          eq(content_history.batch_id, lock.batch_id),
          eq(content_history.social_account_id, lock.social_account_id),
          eq(content_history.platform, lock.platform),
          isNull(content_history.scheduled_post_id),
          gte(content_history.created_at, lock.created_at),
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
