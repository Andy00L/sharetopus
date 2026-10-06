import type { PostCreateInput } from "../validation/schemas";
import type { SchedulePostData } from "@/lib/types/SchedulePostData";
import type { DirectPostData } from "@/actions/server/directPostActions/directPostBatch";
import { buildRegistryPostOptions } from "@/lib/platforms/postTargetOptions";
import { generateBatchId } from "@/lib/utils/generateBatchId";

/** REST input as one schedulePostBatch entry (scheduled_at given); Pinterest and registry options fold into postOptions. */
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

/** REST input as one directPostBatch entry (no scheduled_at); Pinterest fields stay top level there. */
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
