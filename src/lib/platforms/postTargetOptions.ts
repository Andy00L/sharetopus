import { z } from "zod";

import type { MediaType } from "@/db/schema";
import {
  platformRequiresTitle,
  platformSupportsMediaType,
} from "@/lib/platforms/capabilities";
import type { SchedulePostData } from "@/lib/types/SchedulePostData";

/**
 * Registry-provider post options as flat snake_case fields. Each one is
 * read only by the provider named in its description (the key it maps to
 * in post_options is in buildRegistryPostOptions). The REST post body and
 * the MCP posting tools both spread these, so the two accept the same
 * options; findPostTargetIssues enforces the ones a platform cannot
 * publish without.
 */
export const REGISTRY_POST_OPTION_FIELDS = {
  subreddit: z
    .string()
    .min(2)
    .max(50)
    .optional()
    .describe("Reddit: subreddit to post to. Required when platform is reddit."),
  flair_id: z
    .string()
    .max(100)
    .optional()
    .describe("Reddit: flair id for the post."),
  community_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Lemmy: community id. Required when platform is lemmy."),
  publication_id: z
    .string()
    .max(100)
    .optional()
    .describe("Hashnode: publication id. Defaults to the account's first publication."),
  blog: z
    .string()
    .max(100)
    .optional()
    .describe("Tumblr: blog name. Defaults to the blog stored when the account connected."),
  location_name: z
    .string()
    .regex(/^locations\/[0-9]+$/, 'shaped "locations/<id>"')
    .optional()
    .describe(
      'Google Business Profile: location, shaped "locations/<id>". Required when platform is gmb.',
    ),
  organization_id: z
    .string()
    .max(50)
    .optional()
    .describe("LinkedIn Pages: organization id. Defaults to the connected organization."),
  canonical_url: z
    .string()
    .url()
    .max(2048)
    .optional()
    .describe("dev.to: canonical URL of the original article."),
  tags: z
    .array(z.string().min(1).max(50))
    .max(4)
    .optional()
    .describe("dev.to: up to 4 tags."),
};

export const RegistryPostOptionsSchema = z.object(REGISTRY_POST_OPTION_FIELDS);
export type RegistryPostOptionInput = z.infer<typeof RegistryPostOptionsSchema>;

/**
 * Folds the registry option fields into post_options under the keys each
 * provider's publish reads. Returns null when the input carries none, so a
 * post without options keeps a null post_options.
 *
 * Called by: the REST post adapters and the MCP posting tools
 */
export function buildRegistryPostOptions(
  input: RegistryPostOptionInput,
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

/** The fields findPostTargetIssues reads. */
type PostTargetFields = {
  platform: string;
  post_type: MediaType;
  title?: string | null;
  pinterest_board_id?: string;
  subreddit?: string;
  community_id?: number;
  location_name?: string;
};

/**
 * Why a post cannot be published on its platform: a media type the
 * platform does not take, a missing title where the provider requires one
 * (catalog rules.titleRequired), or a missing target the provider's publish
 * refuses to run without (Pinterest board, Reddit subreddit, Lemmy
 * community, Google Business location). The REST post body and the MCP
 * posting tools add these as validation issues, so a bad post fails when
 * it is submitted instead of at publish time.
 */
export function findPostTargetIssues(
  post: PostTargetFields,
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const requiredTargets: { platform: string; path: string; isPresent: boolean }[] = [
    { platform: "pinterest", path: "pinterest_board_id", isPresent: Boolean(post.pinterest_board_id) },
    { platform: "reddit", path: "subreddit", isPresent: Boolean(post.subreddit) },
    { platform: "lemmy", path: "community_id", isPresent: Boolean(post.community_id) },
    { platform: "gmb", path: "location_name", isPresent: Boolean(post.location_name) },
  ];
  for (const target of requiredTargets) {
    if (post.platform === target.platform && !target.isPresent) {
      issues.push({
        path: target.path,
        message: `${target.path} is required when platform is ${target.platform}`,
      });
    }
  }
  if (platformRequiresTitle(post.platform) && !post.title?.trim()) {
    issues.push({
      path: "title",
      message: `title is required when platform is ${post.platform}`,
    });
  }
  if (!platformSupportsMediaType(post.platform, post.post_type)) {
    issues.push({
      path: "post_type",
      message: `${post.post_type} posts are not supported on ${post.platform}`,
    });
  }
  return issues;
}

/** The part of Zod's refinement context refinePostTarget uses. */
type ValidationIssueSink = {
  addIssue: (issue: { code: "custom"; path: string[]; message: string }) => void;
};

/**
 * superRefine callback that reports findPostTargetIssues as validation
 * issues. Called by: the REST post body schema and the MCP posting tool
 * schemas (schedule_post, post_now, bulk_schedule, bulk_post_now).
 */
export function refinePostTarget(
  post: PostTargetFields,
  ctx: ValidationIssueSink,
): void {
  for (const issue of findPostTargetIssues(post)) {
    ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
  }
}
