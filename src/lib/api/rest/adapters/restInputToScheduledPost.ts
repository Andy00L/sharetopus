import type { PostCreateInput } from "../validation/schemas";
import type { SchedulePostData } from "@/lib/types/SchedulePostData";
import type { DirectPostData } from "@/actions/server/directPostActions/directPostBatch";
import { generateBatchId } from "@/lib/utils/generateBatchId";

/**
 * Maps REST API input to the shape schedulePostBatch expects
 * (single-element batch). Used when scheduled_at is provided.
 *
 * Pure function. No DB calls, no side effects. Pattern mirrored from
 * src/lib/mcp/tools/schedulePost.ts (which builds the same shape).
 *
 * Platform-specific knobs (pinterest_board_id, etc.) fold into the
 * postOptions field. The platform adapters already know how to read
 * that structure from the post_options jsonb column.
 */
/**
 * Registry-provider option keys, folded into post_options under the names
 * each provider's publish reads. Returns null when the input carries none,
 * so legacy platforms keep a null post_options exactly as before.
 */
function buildRegistryPostOptions(
  input: PostCreateInput,
): SchedulePostData["postOptions"] {
  const registryOptions: NonNullable<SchedulePostData["postOptions"]> = {};
  if (input.subreddit) registryOptions.subreddit = input.subreddit;
  if (input.flair_id) registryOptions.flairId = input.flair_id;
  if (input.community_id) registryOptions.communityId = input.community_id;
  if (input.publication_id) registryOptions.publicationId = input.publication_id;
  if (input.blog) registryOptions.blog = input.blog;
  if (input.location_name) registryOptions.locationName = input.location_name;
  if (input.organization_id) registryOptions.organizationId = input.organization_id;
  if (input.canonical_url) registryOptions.canonicalUrl = input.canonical_url;
  if (input.tags && input.tags.length > 0) registryOptions.tags = input.tags;
  return Object.keys(registryOptions).length > 0 ? registryOptions : null;
}

export function restInputToSchedulePostData(
  input: PostCreateInput,
): SchedulePostData {
  const pinterestOptions =
    input.platform === "pinterest"
      ? {
          privacyLevel: "PUBLIC" as const,
          board: input.pinterest_board_id ?? "",
          link: input.pinterest_link ?? "",
        }
      : null;

  return {
    socialAccountId: input.social_account_id,
    platform: input.platform,
    scheduledAt: input.scheduled_at ?? new Date().toISOString(),
    postType: input.post_type,
    title: input.title ?? null,
    description: input.description ?? null,
    mediaStoragePath: input.media_storage_path ?? "",
    postOptions: pinterestOptions ?? buildRegistryPostOptions(input),
    batch_id: input.batch_id ?? generateBatchId(),
    idempotency_key: input.idempotency_key,
  };
}

/**
 * Maps REST API input to the shape directPostBatch expects.
 * Used when scheduled_at is omitted (immediate publish).
 *
 * directPostBatch takes DirectPostData which has Pinterest fields
 * at the top level (not nested in postOptions).
 */
export function restInputToDirectPostData(
  input: PostCreateInput,
): DirectPostData {
  return {
    socialAccountId: input.social_account_id,
    platform: input.platform,
    postType: input.post_type,
    title: input.title ?? null,
    description: input.description ?? null,
    mediaStoragePath: input.media_storage_path ?? "",
    pinterestBoardId: input.pinterest_board_id,
    pinterestBoardName: input.pinterest_board_name,
    pinterestLink: input.pinterest_link,
    idempotency_key: input.idempotency_key,
    postOptions: buildRegistryPostOptions(input),
  };
}
