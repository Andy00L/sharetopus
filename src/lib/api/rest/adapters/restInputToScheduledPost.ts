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
    postOptions: pinterestOptions,
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
  };
}
