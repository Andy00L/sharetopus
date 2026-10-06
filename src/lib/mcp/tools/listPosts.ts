import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";
import { and, asc, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db, runQuery } from "@/db/client";
import {
  content_history,
  failed_posts,
  pending_direct_posts,
  scheduled_posts,
  social_accounts,
} from "@/db/schema";
import { IsoDateTimeSchema } from "@/lib/mcp/_shared/isoDateTimeSchema";

import { errorResult, jsonResult, withMcpTool } from "../withMcpTool";

/** Characters of post text a concise row keeps. */
const CONCISE_TEXT_CHARS = 140;

const LIST_STATUSES = ["upcoming", "published", "failed", "cancelled"] as const;

type ListPostsArgs = {
  status: (typeof LIST_STATUSES)[number];
  batch_id?: string;
  social_account_id?: string;
  platform?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
  response_format: "concise" | "detailed";
};

const PostRowSchema = z.object({
  id: z.string(),
  status: z.string(),
  platform: z.string(),
  account: z.string().nullable(),
  time: z.string().nullable(),
  text: z.string().nullable(),
  media_type: z.string().nullable(),
  batch_id: z.string().nullable(),
  error: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  social_account_id: z.string().nullable().optional(),
  content_id: z.string().nullable().optional(),
  media_url: z.string().nullable().optional(),
});

const ListPostsOutputSchema = z.object({
  posts: z.array(PostRowSchema),
  has_more: z.boolean(),
  next_offset: z.number().nullable(),
});

type PostRow = z.infer<typeof PostRowSchema>;

type SourceRow = {
  id: string;
  status: string;
  platform: string;
  accountName: string | null;
  time: string | null;
  text: string | null;
  title: string | null;
  mediaType: string | null;
  batchId: string | null;
  error: string | null;
  socialAccountId: string | null;
  contentId: string | null;
  mediaUrl: string | null;
};

const ACCOUNT_NAME_COLUMNS = {
  displayName: social_accounts.display_name,
  username: social_accounts.username,
};

/** Lists posts by status, or every post of one publish_posts batch, with account names on each row. */
export function registerListPosts(server: McpServer): void {
  server.registerTool(
    "list_posts",
    {
      title: "List Posts",
      description:
        "List posts: upcoming (scheduled, oldest first), published, failed or cancelled (newest first). Pass batch_id from publish_posts to see what happened to each post of that call.",
      inputSchema: z.object({
        status: z.enum(LIST_STATUSES).optional().default("upcoming"),
        batch_id: z.string().max(200).optional().describe("Overrides status: returns every post of that batch."),
        social_account_id: z.guid().optional(),
        platform: z.string().max(32).optional().describe("Platform id, e.g. linkedin."),
        from: IsoDateTimeSchema.optional().describe("ISO 8601 lower time bound."),
        to: IsoDateTimeSchema.optional().describe("ISO 8601 upper time bound."),
        limit: z.number().int().min(1).max(100).optional().default(20),
        offset: z.number().int().min(0).optional().default(0),
        response_format: z
          .enum(["concise", "detailed"])
          .optional()
          .default("concise")
          .describe("detailed adds full text, title, account id, content id and media URL."),
      }),
      outputSchema: ListPostsOutputSchema,
      annotations: { title: "List Posts", readOnlyHint: true, openWorldHint: false },
    },
    withMcpTool("list_posts", async (ctx, args: ListPostsArgs) => {
      const rowsResult = args.batch_id
        ? await loadBatchRows(ctx.principal.principalId, args.batch_id)
        : await loadStatusRows(ctx.principal.principalId, args);
      if (!rowsResult.success) {
        console.error(`[list_posts] [req=${ctx.requestId ?? "?"}] ${rowsResult.message}`);
        return errorResult("Could not load your posts. Retry in a moment.");
      }

      // Status queries fetch one extra row to tell whether another page exists.
      const pageRows = args.batch_id ? rowsResult.rows : rowsResult.rows.slice(0, args.limit);
      const hasMore = !args.batch_id && rowsResult.rows.length > args.limit;
      return jsonResult({
        posts: pageRows.map((sourceRow) => toPostRow(sourceRow, args.response_format)),
        has_more: hasMore,
        next_offset: hasMore ? args.offset + args.limit : null,
      } satisfies z.infer<typeof ListPostsOutputSchema>);
    }),
  );
}

type RowsResult = { success: true; rows: SourceRow[] } | { success: false; message: string };

async function loadStatusRows(principalId: string, args: ListPostsArgs): Promise<RowsResult> {
  const pageSize = args.limit + 1;
  switch (args.status) {
    case "upcoming":
    case "cancelled": {
      const statuses: ("scheduled" | "queued" | "processing" | "cancelled")[] =
        args.status === "upcoming" ? ["scheduled", "queued", "processing"] : ["cancelled"];
      const conditions: (SQL | undefined)[] = [
        eq(scheduled_posts.principal_id, principalId),
        inArray(scheduled_posts.status, statuses),
        args.social_account_id ? eq(scheduled_posts.social_account_id, args.social_account_id) : undefined,
        args.platform ? eq(scheduled_posts.platform, args.platform) : undefined,
        args.from ? gte(scheduled_posts.scheduled_at, args.from) : undefined,
        args.to ? lte(scheduled_posts.scheduled_at, args.to) : undefined,
      ];
      const { data, error } = await runQuery(
        db
          .select({ post: scheduled_posts, ...ACCOUNT_NAME_COLUMNS })
          .from(scheduled_posts)
          .leftJoin(social_accounts, eq(social_accounts.id, scheduled_posts.social_account_id))
          .where(and(...conditions))
          .orderBy(args.status === "upcoming" ? asc(scheduled_posts.scheduled_at) : desc(scheduled_posts.scheduled_at))
          .limit(pageSize)
          .offset(args.offset),
      );
      if (error) return { success: false, message: `scheduled_posts read failed: ${error.message}` };
      return { success: true, rows: data.map(fromScheduledRow) };
    }
    case "published": {
      const conditions: (SQL | undefined)[] = [
        eq(content_history.principal_id, principalId),
        args.social_account_id ? eq(content_history.social_account_id, args.social_account_id) : undefined,
        args.platform ? eq(content_history.platform, args.platform) : undefined,
        args.from ? gte(content_history.created_at, args.from) : undefined,
        args.to ? lte(content_history.created_at, args.to) : undefined,
      ];
      const { data, error } = await runQuery(
        db
          .select({ history: content_history, ...ACCOUNT_NAME_COLUMNS })
          .from(content_history)
          .leftJoin(social_accounts, eq(social_accounts.id, content_history.social_account_id))
          .where(and(...conditions))
          .orderBy(desc(content_history.created_at))
          .limit(pageSize)
          .offset(args.offset),
      );
      if (error) return { success: false, message: `content_history read failed: ${error.message}` };
      return { success: true, rows: data.map(fromHistoryRow) };
    }
    case "failed": {
      const conditions: (SQL | undefined)[] = [
        eq(failed_posts.principal_id, principalId),
        args.social_account_id ? eq(failed_posts.social_account_id, args.social_account_id) : undefined,
        args.platform ? eq(failed_posts.platform, args.platform) : undefined,
        args.from ? gte(failed_posts.created_at, args.from) : undefined,
        args.to ? lte(failed_posts.created_at, args.to) : undefined,
      ];
      const { data, error } = await runQuery(
        db
          .select({ failure: failed_posts, ...ACCOUNT_NAME_COLUMNS })
          .from(failed_posts)
          .leftJoin(social_accounts, eq(social_accounts.id, failed_posts.social_account_id))
          .where(and(...conditions))
          .orderBy(desc(failed_posts.created_at))
          .limit(pageSize)
          .offset(args.offset),
      );
      if (error) return { success: false, message: `failed_posts read failed: ${error.message}` };
      return { success: true, rows: data.map(fromFailedRow) };
    }
    default: {
      const unhandledStatus: never = args.status;
      return { success: false, message: `Unknown status ${String(unhandledStatus)}` };
    }
  }
}

/** Every post of one batch: scheduled rows plus the publish-now jobs and their outcome. */
async function loadBatchRows(principalId: string, batchId: string): Promise<RowsResult> {
  const [scheduledRead, directRead] = await Promise.all([
    runQuery(
      db
        .select({ post: scheduled_posts, ...ACCOUNT_NAME_COLUMNS })
        .from(scheduled_posts)
        .leftJoin(social_accounts, eq(social_accounts.id, scheduled_posts.social_account_id))
        .where(and(eq(scheduled_posts.principal_id, principalId), eq(scheduled_posts.batch_id, batchId)))
        .orderBy(asc(scheduled_posts.scheduled_at)),
    ),
    runQuery(
      db
        .select({ job: pending_direct_posts, ...ACCOUNT_NAME_COLUMNS })
        .from(pending_direct_posts)
        .leftJoin(social_accounts, eq(social_accounts.id, pending_direct_posts.social_account_id))
        .where(and(eq(pending_direct_posts.principal_id, principalId), eq(pending_direct_posts.batch_id, batchId)))
        .orderBy(asc(pending_direct_posts.created_at)),
    ),
  ]);
  if (scheduledRead.error) return { success: false, message: `scheduled_posts read failed: ${scheduledRead.error.message}` };
  if (directRead.error) return { success: false, message: `pending_direct_posts read failed: ${directRead.error.message}` };
  return {
    success: true,
    rows: [...directRead.data.map(fromDirectJobRow), ...scheduledRead.data.map(fromScheduledRow)],
  };
}

function accountNameOf(names: { displayName: string | null; username: string | null }): string | null {
  return names.displayName ?? names.username;
}

function fromScheduledRow(row: { post: typeof scheduled_posts.$inferSelect; displayName: string | null; username: string | null }): SourceRow {
  const { post } = row;
  return {
    id: post.id,
    status: post.status === "posted" ? "published" : post.status,
    platform: post.platform,
    accountName: accountNameOf(row),
    time: post.status === "posted" ? (post.posted_at ?? post.scheduled_at) : post.scheduled_at,
    text: post.post_description,
    title: post.post_title,
    mediaType: post.media_type,
    batchId: post.batch_id,
    error: post.error_message,
    socialAccountId: post.social_account_id,
    contentId: null,
    mediaUrl: null,
  };
}

function fromHistoryRow(row: { history: typeof content_history.$inferSelect; displayName: string | null; username: string | null }): SourceRow {
  const { history } = row;
  return {
    id: history.id,
    status: "published",
    platform: history.platform,
    accountName: accountNameOf(row),
    time: history.created_at,
    text: history.description,
    title: history.title,
    mediaType: history.media_type,
    batchId: history.batch_id,
    error: null,
    socialAccountId: history.social_account_id,
    contentId: history.content_id,
    mediaUrl: history.media_url,
  };
}

function fromFailedRow(row: { failure: typeof failed_posts.$inferSelect; displayName: string | null; username: string | null }): SourceRow {
  const { failure } = row;
  return {
    id: failure.id,
    status: "failed",
    platform: failure.platform,
    accountName: accountNameOf(row),
    time: failure.created_at,
    text: failure.post_description,
    title: failure.post_title,
    mediaType: failure.media_type,
    batchId: failure.batch_id,
    error: failure.error_message,
    socialAccountId: failure.social_account_id,
    contentId: null,
    mediaUrl: null,
  };
}

const DIRECT_JOB_STATUS = { processing: "publishing", completed: "published", failed: "failed" } as const;

function fromDirectJobRow(row: { job: typeof pending_direct_posts.$inferSelect; displayName: string | null; username: string | null }): SourceRow {
  const { job } = row;
  return {
    id: job.event_id,
    status: DIRECT_JOB_STATUS[job.status],
    platform: job.platform,
    accountName: accountNameOf(row),
    time: job.finished_at ?? job.created_at,
    text: null,
    title: null,
    mediaType: null,
    batchId: job.batch_id,
    error: job.failure_reason,
    socialAccountId: job.social_account_id,
    contentId: null,
    mediaUrl: null,
  };
}

function toPostRow(sourceRow: SourceRow, responseFormat: "concise" | "detailed"): PostRow {
  const conciseRow: PostRow = {
    id: sourceRow.id,
    status: sourceRow.status,
    platform: sourceRow.platform,
    account: sourceRow.accountName,
    time: sourceRow.time,
    text:
      responseFormat === "concise" && sourceRow.text && sourceRow.text.length > CONCISE_TEXT_CHARS
        ? `${sourceRow.text.slice(0, CONCISE_TEXT_CHARS)}...`
        : sourceRow.text,
    media_type: sourceRow.mediaType,
    batch_id: sourceRow.batchId,
    ...(sourceRow.error ? { error: sourceRow.error } : {}),
  };
  if (responseFormat === "concise") return conciseRow;
  return {
    ...conciseRow,
    title: sourceRow.title,
    social_account_id: sourceRow.socialAccountId,
    content_id: sourceRow.contentId,
    media_url: sourceRow.mediaUrl,
  };
}
