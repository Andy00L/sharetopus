import "server-only";

import { inArray } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";
import type { PostStatus } from "@/db/schema";
import {
  POST_CHANGE_ELIGIBLE_STATUSES,
  type PostChangeAction,
} from "@/lib/types/postBatch";
import type { PreflightResult } from "@/lib/types/preflight";

export const PUBLISHING_POST_STATUS = "processing" satisfies PostStatus;

export function findPublishingPostIds(posts: { id: string; status: PostStatus }[]): string[] {
  return posts.filter((post) => post.status === PUBLISHING_POST_STATUS).map((post) => post.id);
}

export function describePublishingRefusal(publishingPostIds: string[]): string {
  const subject =
    publishingPostIds.length === 1
      ? `Post ${publishingPostIds[0]} is`
      : `Posts ${publishingPostIds.join(", ")} are`;
  return `${subject} publishing now. Try again in a minute.`;
}

export type PostChangeRuleResult<Post> =
  | { ok: true; eligiblePosts: Post[] }
  | { ok: false; violation: "not_found" }
  | { ok: false; violation: "not_owned"; foreignPostIds: string[] }
  | { ok: false; violation: "not_eligible" };

export function checkPostChangeRules<
  Post extends { id: string; principal_id: string; status: PostStatus },
>(input: {
  posts: Post[];
  principalId: string;
  eligibleStatuses: readonly PostStatus[] | null;
}): PostChangeRuleResult<Post> {
  if (input.posts.length === 0) return { ok: false, violation: "not_found" };
  const foreignPostIds = input.posts
    .filter((post) => post.principal_id !== input.principalId)
    .map((post) => post.id);
  if (foreignPostIds.length > 0) {
    return { ok: false, violation: "not_owned", foreignPostIds };
  }
  const { eligibleStatuses } = input;
  const eligiblePosts = eligibleStatuses
    ? input.posts.filter((post) => eligibleStatuses.includes(post.status))
    : input.posts;
  if (eligiblePosts.length === 0) return { ok: false, violation: "not_eligible" };
  return { ok: true, eligiblePosts };
}

export async function preflightScheduledPostChange(params: {
  postIds: string[];
  principalId: string;
  action: PostChangeAction;
}): Promise<PreflightResult> {
  const eligibleStatuses = POST_CHANGE_ELIGIBLE_STATUSES[params.action];
  const { data: posts, error } = await runQuery(
    db
      .select({
        id: scheduled_posts.id,
        principal_id: scheduled_posts.principal_id,
        status: scheduled_posts.status,
      })
      .from(scheduled_posts)
      .where(inArray(scheduled_posts.id, params.postIds)),
  );

  if (error) {
    console.error(`[preflightScheduledPostChange] scheduled_posts read failed: ${error.message}`);
    return { ok: false, httpStatus: 500, errorKind: "precheck_failed", message: "Could not look up the posts." };
  }
  const rules = checkPostChangeRules({
    posts,
    principalId: params.principalId,
    eligibleStatuses,
  });
  if (rules.ok) {
    const publishingPostIds = params.action === "delete" ? findPublishingPostIds(posts) : [];
    if (publishingPostIds.length === 0) return { ok: true };
    return {
      ok: false,
      httpStatus: 409,
      errorKind: "post_publishing",
      message: describePublishingRefusal(publishingPostIds),
    };
  }
  switch (rules.violation) {
    case "not_found":
      return { ok: false, httpStatus: 404, errorKind: "posts_not_found", message: "No posts found for these ids." };
    case "not_owned":
      return {
        ok: false,
        httpStatus: 403,
        errorKind: "post_not_owned",
        message: "Some of these posts do not belong to the paying wallet.",
      };
    case "not_eligible":
      return {
        ok: false,
        httpStatus: 409,
        errorKind: "no_eligible_posts",
        message: `None of these posts is in an eligible state (${(eligibleStatuses ?? []).join(", ")}).`,
      };
    default: {
      const unhandledViolation: never = rules;
      return unhandledViolation;
    }
  }
}
