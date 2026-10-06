import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { loadOwnedAccountPlatforms } from "@/actions/server/data/loadOwnedAccountPlatforms";
import {
  directPostBatch,
  type DirectPostData,
} from "@/actions/server/directPostActions/directPostBatch";
import { schedulePostBatch } from "@/actions/server/scheduleActions/schedule/schedulePostBatch";
import { MEDIA_TYPES } from "@/db/schema";
import { IsoDateTimeSchema } from "@/lib/mcp/_shared/isoDateTimeSchema";
import { isSchedulablePlatform } from "@/lib/platforms/capabilities";
import {
  REGISTRY_POST_OPTION_FIELDS,
  buildRegistryPostOptions,
  findPostTargetIssues,
} from "@/lib/platforms/postTargetOptions";
import type { SchedulePostData } from "@/lib/types/SchedulePostData";
import { generateBatchId } from "@/lib/utils/generateBatchId";

import { errorResult, jsonResult, withMcpTool } from "../withMcpTool";

/** directPostBatch accepts at most 30 posts per call. */
const MAX_POSTS_PER_CALL = 30;

const PublishPostInputSchema = z.object({
  social_account_id: z
    .guid()
    .describe("Account id from list_connections. The platform follows from the account."),
  post_type: z.enum(MEDIA_TYPES).describe("The platform must accept this type."),
  description: z
    .string()
    .nullable()
    .describe("Caption or body text. Required for text posts."),
  title: z
    .string()
    .optional()
    .describe(
      "Required on reddit, lemmy, devto, hashnode, medium, wordpress and dribbble. Pinterest and YouTube use it too.",
    ),
  media_storage_path: z
    .string()
    .optional()
    .default("")
    .describe("From attach_media_from_url or request_upload_url. Required for image and video."),
  scheduled_at: IsoDateTimeSchema
    .optional()
    .describe("Future ISO 8601 time with a zone (Z or +02:00) to schedule the post. Omit to publish now."),
  cover_timestamp: z
    .number()
    .int()
    .min(1000)
    .optional()
    .describe("TikTok video cover frame in ms (at least 1000)."),
  pinterest_board_id: z
    .string()
    .optional()
    .describe("Required for Pinterest. From list_pinterest_boards."),
  pinterest_link: z.url().max(2048).optional().describe("Pinterest: where the pin links to."),
  ...REGISTRY_POST_OPTION_FIELDS,
});

type PublishPostInput = z.infer<typeof PublishPostInputSchema>;

type PublishPostsArgs = {
  posts: PublishPostInput[];
  batch_id?: string;
};

const PublishPostsOutputSchema = z.object({
  batch_id: z.string(),
  publishing_now: z.number(),
  scheduled: z.number(),
  duplicates: z.number(),
  rejected: z.array(z.object({ social_account_id: z.string(), reason: z.string() })),
  event_ids: z.array(z.string()),
  schedule_ids: z.array(z.string()),
  message: z.string(),
});

type PublishPostsOutput = z.infer<typeof PublishPostsOutputSchema>;
type Rejection = PublishPostsOutput["rejected"][number];

/** Publishes or schedules 1 to 30 posts in one call; list_posts with the batch_id shows the results. */
export function registerPublishPosts(server: McpServer): void {
  server.registerTool(
    "publish_posts",
    {
      title: "Publish Posts",
      description: `Publish or schedule 1 to ${MAX_POSTS_PER_CALL} posts. A post with scheduled_at is scheduled; one without it is published now. To cross-post, add one entry per account with the same media_storage_path. Check the outcome with list_posts and the returned batch_id.`,
      inputSchema: z.object({
        posts: z.array(PublishPostInputSchema).min(1).max(MAX_POSTS_PER_CALL),
        batch_id: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe("Reuse the same batch_id when retrying: posts it already created are not duplicated."),
      }),
      outputSchema: PublishPostsOutputSchema,
      annotations: {
        title: "Publish Posts",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    withMcpTool(
      "publish_posts",
      async (ctx, args: PublishPostsArgs) => {
        const batchId = args.batch_id ?? generateBatchId();
        const idempotencyKeyFor = (postIndex: number) =>
          args.batch_id ? `${batchId}:${postIndex}` : undefined;

        const ownership = await loadOwnedAccountPlatforms(
          args.posts.map((post) => post.social_account_id),
          ctx.principal.principalId,
        );
        if (!ownership.success) {
          console.error(`[publish_posts] [req=${ctx.requestId ?? "?"}] ${ownership.message}`);
          return errorResult("Could not check account ownership. Retry in a moment.");
        }

        const rejected: Rejection[] = [];
        const postsToSchedule: SchedulePostData[] = [];
        const postsToPublishNow: DirectPostData[] = [];

        args.posts.forEach((post, postIndex) => {
          const platform = ownership.platformByAccountId.get(post.social_account_id);
          if (!platform || !isSchedulablePlatform(platform)) {
            rejected.push({
              social_account_id: post.social_account_id,
              reason: "Unknown social_account_id. Call list_connections for your account ids.",
            });
            return;
          }

          const targetIssues = findPostTargetIssues({ ...post, platform });
          if (targetIssues.length > 0) {
            rejected.push({
              social_account_id: post.social_account_id,
              reason: targetIssues.map((issue) => issue.message).join("; "),
            });
            return;
          }

          const pinterestOptions =
            platform === "pinterest"
              ? { board: post.pinterest_board_id ?? "", link: post.pinterest_link ?? "" }
              : null;

          if (post.scheduled_at) {
            postsToSchedule.push({
              socialAccountId: post.social_account_id,
              platform,
              scheduledAt: post.scheduled_at,
              postType: post.post_type,
              title: post.title ?? null,
              description: post.description,
              mediaStoragePath: post.media_storage_path,
              coverTimestamp: post.cover_timestamp,
              postOptions: pinterestOptions ?? buildRegistryPostOptions(post),
              batch_id: batchId,
              idempotency_key: idempotencyKeyFor(postIndex),
            });
          } else {
            postsToPublishNow.push({
              socialAccountId: post.social_account_id,
              platform,
              postType: post.post_type,
              title: post.title ?? null,
              description: post.description,
              mediaStoragePath: post.media_storage_path,
              coverTimestamp: post.cover_timestamp,
              pinterestBoardId: post.pinterest_board_id,
              pinterestLink: post.pinterest_link,
              idempotency_key: idempotencyKeyFor(postIndex),
              postOptions: buildRegistryPostOptions(post),
            });
          }
        });

        const batchErrors: string[] = [];
        let scheduledCount = 0;
        let publishingNowCount = 0;
        let duplicates = 0;
        let scheduleIds: string[] = [];
        let eventIds: string[] = [];

        if (postsToSchedule.length > 0) {
          const scheduleResult = await schedulePostBatch(
            postsToSchedule,
            ctx.principal.principalId,
            "mcp",
            ctx.requestId,
          );
          scheduledCount = scheduleResult.details.inserted;
          duplicates += scheduleResult.details.duplicates;
          scheduleIds = scheduleResult.scheduleIds;
          rejected.push(...toRejections(scheduleResult.details.rejected));
          if (!scheduleResult.success && scheduleResult.details.rejected.length === 0) {
            batchErrors.push(`Scheduling failed: ${scheduleResult.message}`);
          }
        }

        if (postsToPublishNow.length > 0) {
          const publishResult = await directPostBatch(
            postsToPublishNow,
            ctx.principal.principalId,
            "mcp",
            batchId,
            ctx.requestId,
          );
          publishingNowCount = publishResult.details.dispatched;
          duplicates += publishResult.details.duplicates;
          eventIds = publishResult.eventIds;
          rejected.push(...toRejections(publishResult.details.rejected));
          if (!publishResult.success && publishResult.details.rejected.length === 0) {
            batchErrors.push(`Publishing failed: ${publishResult.message}`);
          }
        }

        const auditArgs = {
          count: args.posts.length,
          batch_id: batchId,
          scheduled: postsToSchedule.length,
          now: postsToPublishNow.length,
        };

        if (scheduledCount + publishingNowCount + duplicates === 0) {
          const reasons = [
            ...batchErrors,
            ...rejected.map((rejection) => `${rejection.social_account_id}: ${rejection.reason}`),
          ];
          return { ...errorResult(`Nothing was published. ${reasons.join(" | ")}`), auditArgs };
        }

        const output: PublishPostsOutput = {
          batch_id: batchId,
          publishing_now: publishingNowCount,
          scheduled: scheduledCount,
          duplicates,
          rejected,
          event_ids: eventIds,
          schedule_ids: scheduleIds,
          message: [
            `${publishingNowCount} publishing now, ${scheduledCount} scheduled`,
            duplicates > 0 ? `${duplicates} already existed` : null,
            rejected.length > 0 ? `${rejected.length} rejected` : null,
            ...batchErrors,
            "Call list_posts with this batch_id in about a minute to see the results.",
          ]
            .filter((part) => part !== null)
            .join(". "),
        };
        return jsonResult(output, auditArgs);
      },
      { auditArgsBuilder: (args) => ({ count: args.posts.length }) },
    ),
  );
}

function toRejections(
  coreRejections: { socialAccountId: string; reason: string }[],
): Rejection[] {
  return coreRejections.map((coreRejection) => ({
    social_account_id: coreRejection.socialAccountId,
    reason: coreRejection.reason,
  }));
}
