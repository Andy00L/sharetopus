// A fake Sharetopus account (4 connected accounts, 4 scheduled and 3 published posts) and
// executors for the old 18-tool set and the new 10-tool set. Nothing leaves the process.

export type JsonObject = Record<string, unknown>;
export type ToolResult = { text: string; isError: boolean };
export type ToolSetVersion = "before" | "after";

export type MockAccount = {
  id: string;
  platform: string;
  name: string;
  username: string;
  isAvailable: boolean;
  followers: number;
};

export type MockPost = {
  id: string;
  accountId: string;
  platform: string;
  status: "scheduled" | "cancelled" | "published";
  scheduledAt: string | null;
  publishedAt: string | null;
  text: string | null;
  title: string | null;
  mediaType: string;
  mediaPath: string;
  boardId: string | null;
  batchId: string;
  isSeed: boolean;
};

export type MockWorld = {
  now: Date;
  accounts: MockAccount[];
  posts: MockPost[];
  deletedPostIds: string[];
  uploadedPaths: string[];
  nextId: number;
};

export const EVAL_NOW = "2026-10-06T16:00:00Z";
export const PRINCIPAL_ID = "user_2eval";
export const RECONNECT_URL = "https://sharetopus.com/connections";
export const FALL_BOARD_ID = "1029384756";

export const ACCOUNT_IDS = {
  linkedin: "a1000000-0000-4000-8000-000000000001",
  pinterest: "a1000000-0000-4000-8000-000000000002",
  bluesky: "a1000000-0000-4000-8000-000000000003",
  tiktok: "a1000000-0000-4000-8000-000000000004",
} as const;

export const SEED_POST_IDS = {
  fridayTips: "b2000000-0000-4000-8000-000000000001",
  fridayStream: "b2000000-0000-4000-8000-000000000002",
  midWeekRecap: "b2000000-0000-4000-8000-000000000003",
  oldPromo: "b2000000-0000-4000-8000-000000000004",
} as const;

/** Media types each mock platform accepts (a subset of the catalog's supportedMediaTypes). */
const MEDIA_TYPES_BY_PLATFORM: Record<string, string[]> = {
  linkedin: ["text", "image", "video"],
  pinterest: ["image", "video"],
  bluesky: ["text", "image"],
  tiktok: ["image", "video"],
};

const PINTEREST_BOARDS = [
  { id: FALL_BOARD_ID, name: "Fall Launch", description: "Autumn product photos", privacy: "PUBLIC", pin_count: 42 },
  { id: "5647382910", name: "Recipes", description: "", privacy: "PUBLIC", pin_count: 7 },
];

/** A fresh copy of the seed account; every eval run starts from it. */
export function createMockWorld(): MockWorld {
  const seedPost = (fields: Omit<MockPost, "isSeed" | "boardId" | "mediaPath" | "title"> & Partial<MockPost>): MockPost => ({
    title: null,
    mediaPath: "",
    boardId: null,
    isSeed: true,
    ...fields,
  });
  return {
    now: new Date(EVAL_NOW),
    accounts: [
      { id: ACCOUNT_IDS.linkedin, platform: "linkedin", name: "Andy Builds", username: "andy-builds", isAvailable: true, followers: 1840 },
      { id: ACCOUNT_IDS.pinterest, platform: "pinterest", name: "Andy Pins", username: "andypins", isAvailable: true, followers: 312 },
      { id: ACCOUNT_IDS.bluesky, platform: "bluesky", name: "Andy", username: "andy.bsky.social", isAvailable: true, followers: 655 },
      { id: ACCOUNT_IDS.tiktok, platform: "tiktok", name: "Andy Creates", username: "andycreates", isAvailable: false, followers: 9100 },
    ],
    posts: [
      seedPost({ id: SEED_POST_IDS.fridayTips, accountId: ACCOUNT_IDS.linkedin, platform: "linkedin", status: "scheduled", scheduledAt: "2026-10-09T15:00:00Z", publishedAt: null, text: "Friday tips: ship small, ship often.", mediaType: "text", batchId: "seed-batch-1" }),
      seedPost({ id: SEED_POST_IDS.fridayStream, accountId: ACCOUNT_IDS.bluesky, platform: "bluesky", status: "scheduled", scheduledAt: "2026-10-09T18:00:00Z", publishedAt: null, text: "Friday demo stream at 2pm ET.", mediaType: "text", batchId: "seed-batch-2" }),
      seedPost({ id: SEED_POST_IDS.midWeekRecap, accountId: ACCOUNT_IDS.linkedin, platform: "linkedin", status: "scheduled", scheduledAt: "2026-10-14T13:00:00Z", publishedAt: null, text: "Mid-week recap of what shipped.", mediaType: "text", batchId: "seed-batch-3" }),
      seedPost({ id: SEED_POST_IDS.oldPromo, accountId: ACCOUNT_IDS.bluesky, platform: "bluesky", status: "cancelled", scheduledAt: "2026-10-02T14:00:00Z", publishedAt: null, text: "Old promo: 20% off all plans this week.", mediaType: "text", batchId: "seed-batch-4" }),
      seedPost({ id: "c3000000-0000-4000-8000-000000000001", accountId: ACCOUNT_IDS.linkedin, platform: "linkedin", status: "published", scheduledAt: null, publishedAt: "2026-10-01T14:00:00Z", text: "Launch week recap: 3 features, 0 outages.", mediaType: "text", batchId: "seed-batch-5" }),
      seedPost({ id: "c3000000-0000-4000-8000-000000000002", accountId: ACCOUNT_IDS.linkedin, platform: "linkedin", status: "published", scheduledAt: null, publishedAt: "2026-10-02T14:00:00Z", text: "Why we picked Postgres for scheduling.", mediaType: "text", batchId: "seed-batch-6" }),
      seedPost({ id: "c3000000-0000-4000-8000-000000000003", accountId: ACCOUNT_IDS.bluesky, platform: "bluesky", status: "published", scheduledAt: null, publishedAt: "2026-10-03T14:00:00Z", text: "Hello Bluesky!", mediaType: "text", batchId: "seed-batch-7" }),
    ],
    deletedPostIds: [],
    uploadedPaths: [],
    nextId: 1,
  };
}

/** Runs one tool call of the given tool set against the world. */
export function runMockTool(world: MockWorld, version: ToolSetVersion, toolName: string, input: JsonObject): ToolResult {
  return version === "before" ? runOldTool(world, toolName, input) : runNewTool(world, toolName, input);
}

// ---------- shared rules ----------

type PostFields = {
  account: MockAccount;
  postType: string;
  mediaPath: string;
  boardId: string | null;
  title: string | null;
  scheduledAt: string | null;
};

function findPostIssues(world: MockWorld, fields: PostFields): string[] {
  const issues: string[] = [];
  const { account } = fields;
  if (!account.isAvailable) {
    issues.push(`account ${account.username} needs to be reconnected before it can post`);
  }
  if (!(MEDIA_TYPES_BY_PLATFORM[account.platform] ?? []).includes(fields.postType)) {
    issues.push(`${fields.postType} posts are not supported on ${account.platform}`);
  }
  if ((fields.postType === "image" || fields.postType === "video") && !fields.mediaPath) {
    issues.push("media_storage_path is required for image and video posts");
  }
  if (fields.mediaPath && !world.uploadedPaths.includes(fields.mediaPath)) {
    issues.push(`media_storage_path ${fields.mediaPath} was not found in storage`);
  }
  if (account.platform === "pinterest" && !fields.boardId) {
    issues.push("pinterest_board_id is required when platform is pinterest");
  }
  if (fields.scheduledAt !== null) {
    const scheduledTime = Date.parse(fields.scheduledAt);
    if (Number.isNaN(scheduledTime) || scheduledTime <= world.now.getTime()) {
      issues.push("scheduled_at must be a future ISO 8601 timestamp");
    }
  }
  return issues;
}

function createPost(world: MockWorld, fields: PostFields & { text: string | null; batchId: string }): MockPost {
  const post: MockPost = {
    id: `d4000000-0000-4000-8000-${String(world.nextId++).padStart(12, "0")}`,
    accountId: fields.account.id,
    platform: fields.account.platform,
    status: fields.scheduledAt ? "scheduled" : "published",
    scheduledAt: fields.scheduledAt,
    publishedAt: fields.scheduledAt ? null : world.now.toISOString(),
    text: fields.text,
    title: fields.title,
    mediaType: fields.postType,
    mediaPath: fields.mediaPath,
    boardId: fields.boardId,
    batchId: fields.batchId,
    isSeed: false,
  };
  world.posts.push(post);
  return post;
}

function attachMedia(world: MockWorld, url: string): { storage_path: string; content_type: string; size_bytes: number } | null {
  const extension = url.split("?")[0]?.split(".").pop()?.toLowerCase() ?? "";
  const contentType = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", mp4: "video/mp4" }[extension];
  if (!contentType) return null;
  const storagePath = `${PRINCIPAL_ID}/media-${world.nextId++}.${extension}`;
  world.uploadedPaths.push(storagePath);
  return { storage_path: storagePath, content_type: contentType, size_bytes: contentType.startsWith("video") ? 18_400_000 : 412_000 };
}

function findAccount(world: MockWorld, accountId: string | undefined): MockAccount | undefined {
  return world.accounts.find((account) => account.id === accountId);
}

function accountNameOf(world: MockWorld, accountId: string): string {
  return findAccount(world, accountId)?.name ?? "unknown";
}

type ChangeAction = "cancel" | "resume" | "reschedule" | "delete";

/** Applies a cancel, resume, reschedule or delete; unknown ids fail the whole call like the real cores. */
function changePosts(world: MockWorld, postIds: string[], action: ChangeAction, newTime: string | null): { ok: true; succeeded: number; failed: number } | { ok: false; message: string } {
  const unknownIds = postIds.filter((postId) => !world.posts.some((post) => post.id === postId && post.status !== "published"));
  if (unknownIds.length > 0) return { ok: false, message: `No post found for id(s): ${unknownIds.join(", ")}.` };
  if (action === "reschedule") {
    const newTimeMs = newTime ? Date.parse(newTime) : Number.NaN;
    if (Number.isNaN(newTimeMs) || newTimeMs <= world.now.getTime()) {
      return { ok: false, message: "The new time must be a future ISO 8601 timestamp." };
    }
  }
  let succeeded = 0;
  for (const postId of postIds) {
    const post = world.posts.find((candidate) => candidate.id === postId);
    if (!post) continue;
    if (action === "cancel" && post.status === "scheduled") {
      post.status = "cancelled";
      succeeded++;
    } else if (action === "resume" && post.status === "cancelled") {
      post.status = "scheduled";
      if (post.scheduledAt && Date.parse(post.scheduledAt) <= world.now.getTime()) {
        post.scheduledAt = new Date(world.now.getTime() + 3_600_000).toISOString();
      }
      succeeded++;
    } else if (action === "reschedule" && newTime) {
      post.status = "scheduled";
      post.scheduledAt = newTime;
      succeeded++;
    } else if (action === "delete") {
      world.posts = world.posts.filter((candidate) => candidate.id !== postId);
      world.deletedPostIds.push(postId);
      succeeded++;
    }
  }
  return { ok: true, succeeded, failed: postIds.length - succeeded };
}

const ANALYTICS_ROWS = [
  { date: "2026-10-05", platform: "linkedin", content_id: "urn:li:share:7001", views: 1204, likes: 61, comments: 9, shares: 4, subscribers: 3 },
  { date: "2026-10-04", platform: "bluesky", content_id: "at://andy/post/3k2", views: 380, likes: 22, comments: 2, shares: 5, subscribers: 1 },
];

// ---------- input readers ----------

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(input: JsonObject, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(input: JsonObject, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" ? value : undefined;
}

function readStringArray(input: JsonObject, key: string): string[] {
  const value = input[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readObjectArray(input: JsonObject, key: string): JsonObject[] {
  const value = input[key];
  return Array.isArray(value) ? value.filter(isJsonObject) : [];
}

const okJson = (value: unknown, isPretty: boolean): ToolResult => ({
  text: isPretty ? JSON.stringify(value, null, 2) : JSON.stringify(value),
  isError: false,
});
const failWith = (message: string): ToolResult => ({ text: message, isError: true });

// ---------- old tool set (18 tools, pretty-printed full rows) ----------

function toOldScheduledRow(post: MockPost): JsonObject {
  return {
    id: post.id,
    principal_id: PRINCIPAL_ID,
    social_account_id: post.accountId,
    platform: post.platform,
    scheduled_at: post.scheduledAt,
    status: post.status,
    post_title: post.title,
    post_description: post.text,
    media_type: post.mediaType,
    media_storage_path: post.mediaPath,
    batch_id: post.batchId,
    post_options: post.boardId ? { board: post.boardId, link: "", privacyLevel: "PUBLIC" } : null,
    error_message: null,
    posted_at: null,
    idempotency_key: null,
    created_via: "mcp",
    cancelled_by_sub_at: null,
    retry_count: 0,
    created_at: "2026-10-01T12:00:00.000Z",
    updated_at: "2026-10-01T12:00:00.000Z",
  };
}

function toOldHistoryRow(post: MockPost): JsonObject {
  return {
    id: post.id,
    principal_id: PRINCIPAL_ID,
    social_account_id: post.accountId,
    platform: post.platform,
    content_id: `${post.platform}-${post.id.slice(-4)}`,
    title: post.title,
    description: post.text,
    media_url: post.mediaPath || null,
    media_type: post.mediaType,
    status: "published",
    batch_id: post.batchId,
    created_via: "web",
    extra: null,
    created_at: post.publishedAt,
    updated_at: post.publishedAt,
  };
}

/** One old single-post call (schedule_post or post_now), with the platform argument checked. */
function runOldSinglePost(world: MockWorld, input: JsonObject, isScheduled: boolean): ToolResult {
  const account = findAccount(world, readString(input, "social_account_id"));
  if (!account) return failWith("Social account not found or does not belong to you.");
  if (readString(input, "platform") !== account.platform) {
    return failWith(`Account ${account.id} is a ${account.platform} account, not ${readString(input, "platform") ?? "(none)"}.`);
  }
  const fields: PostFields = {
    account,
    postType: readString(input, "post_type") ?? "",
    mediaPath: readString(input, "media_storage_path") ?? "",
    boardId: readString(input, "pinterest_board_id") ?? null,
    title: readString(input, "title") ?? null,
    scheduledAt: isScheduled ? (readString(input, "scheduled_at") ?? "") : null,
  };
  const issues = findPostIssues(world, fields);
  if (issues.length > 0) return failWith(`Validation failed: ${issues.join("; ")}`);
  const batchId = readString(input, "batch_id") || `batch-${world.nextId}`;
  const post = createPost(world, { ...fields, text: readString(input, "description") ?? null, batchId });
  return okJson(
    isScheduled
      ? { success: true, schedule_id: post.id, batch_id: batchId, idempotent_retry: false, message: "Scheduled 1 post(s)." }
      : { success: true, event_id: `evt-${post.id.slice(-6)}`, batch_id: batchId, idempotent_retry: false, message: "Post dispatched. Check list_content_history in 30-60 seconds." },
    true,
  );
}

/** One old bulk call; like the old schemas, any bad item fails the whole call. */
function runOldBulk(world: MockWorld, input: JsonObject, isScheduled: boolean): ToolResult {
  const items = readObjectArray(input, "posts");
  const prepared: (PostFields & { text: string | null })[] = [];
  for (const [itemIndex, item] of items.entries()) {
    const account = findAccount(world, readString(item, "social_account_id"));
    if (!account) return failWith(`posts.${itemIndex}.social_account_id: account not found`);
    if (readString(item, "platform") !== account.platform) {
      return failWith(`posts.${itemIndex}.platform: account is ${account.platform}`);
    }
    const fields: PostFields = {
      account,
      postType: readString(item, "post_type") ?? "",
      mediaPath: readString(item, "media_storage_path") ?? "",
      boardId: readString(item, "pinterest_board_id") ?? null,
      title: readString(item, "title") ?? null,
      scheduledAt: isScheduled ? (readString(item, "scheduled_at") ?? "") : null,
    };
    const issues = findPostIssues(world, fields);
    if (issues.length > 0) return failWith(`posts.${itemIndex}: ${issues.join("; ")}`);
    prepared.push({ ...fields, text: readString(item, "description") ?? null });
  }
  const batchId = readString(input, "batch_id") || `batch-${world.nextId}`;
  const created = prepared.map((fields) => createPost(world, { ...fields, batchId }));
  return okJson(
    isScheduled
      ? { success: true, batch_id: batchId, total: created.length, inserted: created.length, duplicates: 0, rejected: [], schedule_ids: created.map((post) => post.id) }
      : { success: true, batch_id: batchId, total: created.length, dispatched: created.length, duplicates: 0, results: created.map((post, postIndex) => ({ index: postIndex, platform: post.platform, social_account_id: post.accountId, event_id: `evt-${post.id.slice(-6)}` })) },
    true,
  );
}

function runOldChange(world: MockWorld, input: JsonObject, action: ChangeAction): ToolResult {
  const postIds = readStringArray(input, "post_ids");
  const changeResult = changePosts(world, postIds, action, readString(input, "new_scheduled_time") ?? null);
  if (!changeResult.ok) return okJson({ success: false, message: changeResult.message }, true);
  return okJson(
    {
      success: true,
      message: `${changeResult.succeeded} post(s) updated.`,
      details: {
        total: postIds.length,
        succeeded: changeResult.succeeded,
        failed: changeResult.failed,
        results: postIds.map((postId) => ({ id: postId, success: true })),
      },
    },
    true,
  );
}

function runOldTool(world: MockWorld, toolName: string, input: JsonObject): ToolResult {
  switch (toolName) {
    case "list_connections": {
      const includeUnavailable = input.include_unavailable === true;
      const accounts = world.accounts
        .filter((account) => includeUnavailable || account.isAvailable)
        .map((account) => ({ id: account.id, platform: account.platform, display_name: account.name, username: account.username, avatar_url: `https://cdn.sharetopus.com/avatars/${account.username}.png`, is_available: account.isAvailable, follower_count: account.followers }));
      return okJson(accounts, true);
    }
    case "list_pinterest_boards":
      return okJson({ success: true, boards: PINTEREST_BOARDS, bookmark: null }, true);
    case "list_scheduled_posts": {
      const platform = readString(input, "platform");
      const status = readString(input, "status");
      const rows = world.posts
        .filter((post) => post.status !== "published")
        .filter((post) => !platform || post.platform === platform)
        .filter((post) => !status || post.status === status)
        .slice(0, readNumber(input, "limit") ?? 20)
        .map(toOldScheduledRow);
      return okJson(rows, true);
    }
    case "list_content_history": {
      const platform = readString(input, "platform");
      const rows = world.posts
        .filter((post) => post.status === "published" && (!platform || post.platform === platform))
        .slice(0, readNumber(input, "limit") ?? 20)
        .map(toOldHistoryRow);
      return okJson(rows, true);
    }
    case "list_billing_summary":
      return okJson({ subscription: { plan: "Creator", status: "active", current_period_end: "2026-10-28T00:00:00Z" }, usage: { period: "2026-10-01", schedule_post: 12, post_now: 4 } }, true);
    case "request_account_reauth_link": {
      const account = findAccount(world, readString(input, "social_account_id"));
      if (!account) return failWith("Social account not found or does not belong to you.");
      return okJson({ account_id: account.id, platform: account.platform, display_name: account.name, is_available: account.isAvailable, reauth_url: RECONNECT_URL, message: "Open reauth_url in a browser to reconnect." }, true);
    }
    case "get_account_analytics":
      return okJson(ANALYTICS_ROWS, true);
    case "generate_post_draft":
      return okJson({ instruction: `Write a ${readString(input, "tone") ?? "professional"} ${readString(input, "platform") ?? ""} post about ${readString(input, "topic") ?? ""}. Return only the post text.` }, true);
    case "schedule_post":
      return runOldSinglePost(world, input, true);
    case "post_now":
      return runOldSinglePost(world, input, false);
    case "bulk_schedule":
      return runOldBulk(world, input, true);
    case "bulk_post_now":
      return runOldBulk(world, input, false);
    case "cancel_scheduled_posts":
      return runOldChange(world, input, "cancel");
    case "resume_scheduled_posts":
      return runOldChange(world, input, "resume");
    case "reschedule_posts":
      return runOldChange(world, input, "reschedule");
    case "delete_scheduled_posts":
      return runOldChange(world, input, "delete");
    case "attach_media_from_url": {
      const attached = attachMedia(world, readString(input, "url") ?? "");
      if (!attached) return failWith("Unsupported media type. Allowed: image/jpeg, image/png, video/mp4.");
      return okJson({ success: true, ...attached, next_step: "Pass storage_path as media_storage_path to schedule_post or post_now." }, true);
    }
    case "request_upload_url":
      return okJson({ success: true, upload_url: "https://storage.example/upload?token=abc", storage_path: `${PRINCIPAL_ID}/upload-1.mp4`, token: "abc", expires_in_seconds: 7200 }, true);
    default:
      return failWith(`Unknown tool ${toolName}.`);
  }
}

// ---------- new tool set (10 tools, compact JSON) ----------

function toConciseRow(world: MockWorld, post: MockPost, isDetailed: boolean): JsonObject {
  const text = post.text && !isDetailed && post.text.length > 140 ? `${post.text.slice(0, 140)}...` : post.text;
  const conciseRow: JsonObject = {
    id: post.id,
    status: post.status,
    platform: post.platform,
    account: accountNameOf(world, post.accountId),
    time: post.status === "published" ? post.publishedAt : post.scheduledAt,
    text,
    media_type: post.mediaType,
    batch_id: post.batchId,
  };
  return isDetailed ? { ...conciseRow, title: post.title, social_account_id: post.accountId, content_id: null, media_url: post.mediaPath || null } : conciseRow;
}

function runListPosts(world: MockWorld, input: JsonObject): ToolResult {
  const isDetailed = readString(input, "response_format") === "detailed";
  const batchId = readString(input, "batch_id");
  if (batchId) {
    const rows = world.posts.filter((post) => post.batchId === batchId).map((post) => toConciseRow(world, post, isDetailed));
    return okJson({ posts: rows, has_more: false, next_offset: null }, false);
  }
  const status = readString(input, "status") ?? "upcoming";
  const wantedStatus = status === "upcoming" ? "scheduled" : status;
  const platform = readString(input, "platform");
  const accountId = readString(input, "social_account_id");
  const fromMs = Date.parse(readString(input, "from") ?? "");
  const toMs = Date.parse(readString(input, "to") ?? "");
  const limit = readNumber(input, "limit") ?? 20;
  const offset = readNumber(input, "offset") ?? 0;
  const matching = world.posts
    .filter((post) => post.status === wantedStatus)
    .filter((post) => !platform || post.platform === platform)
    .filter((post) => !accountId || post.accountId === accountId)
    .filter((post) => {
      const timeMs = Date.parse((post.status === "published" ? post.publishedAt : post.scheduledAt) ?? "");
      return (Number.isNaN(fromMs) || timeMs >= fromMs) && (Number.isNaN(toMs) || timeMs <= toMs);
    })
    .sort((left, right) => {
      const leftMs = Date.parse((left.publishedAt ?? left.scheduledAt) ?? "");
      const rightMs = Date.parse((right.publishedAt ?? right.scheduledAt) ?? "");
      return status === "upcoming" ? leftMs - rightMs : rightMs - leftMs;
    });
  const page = matching.slice(offset, offset + limit);
  const hasMore = matching.length > offset + limit;
  return okJson({ posts: page.map((post) => toConciseRow(world, post, isDetailed)), has_more: hasMore, next_offset: hasMore ? offset + limit : null }, false);
}

function runPublishPosts(world: MockWorld, input: JsonObject): ToolResult {
  const batchId = readString(input, "batch_id") ?? `batch-${world.nextId}`;
  const rejected: { social_account_id: string; reason: string }[] = [];
  const created: MockPost[] = [];
  for (const item of readObjectArray(input, "posts")) {
    const accountId = readString(item, "social_account_id") ?? "";
    const account = findAccount(world, accountId);
    if (!account) {
      rejected.push({ social_account_id: accountId, reason: "Unknown social_account_id. Call list_connections for your account ids." });
      continue;
    }
    const fields: PostFields = {
      account,
      postType: readString(item, "post_type") ?? "",
      mediaPath: readString(item, "media_storage_path") ?? "",
      boardId: readString(item, "pinterest_board_id") ?? null,
      title: readString(item, "title") ?? null,
      scheduledAt: readString(item, "scheduled_at") ?? null,
    };
    const issues = findPostIssues(world, fields);
    if (issues.length > 0) {
      rejected.push({ social_account_id: accountId, reason: issues.join("; ") });
      continue;
    }
    created.push(createPost(world, { ...fields, text: readString(item, "description") ?? null, batchId }));
  }
  if (created.length === 0) {
    return failWith(`Nothing was published. ${rejected.map((rejection) => `${rejection.social_account_id}: ${rejection.reason}`).join(" | ")}`);
  }
  const publishingNow = created.filter((post) => post.status === "published").length;
  const scheduled = created.length - publishingNow;
  return okJson(
    {
      batch_id: batchId,
      publishing_now: publishingNow,
      scheduled,
      duplicates: 0,
      rejected,
      event_ids: created.filter((post) => post.status === "published").map((post) => `evt-${post.id.slice(-6)}`),
      schedule_ids: created.filter((post) => post.status === "scheduled").map((post) => post.id),
      message: `${publishingNow} publishing now, ${scheduled} scheduled${rejected.length > 0 ? `. ${rejected.length} rejected` : ""}. Call list_posts with this batch_id in about a minute to see the results.`,
    },
    false,
  );
}

function runNewTool(world: MockWorld, toolName: string, input: JsonObject): ToolResult {
  switch (toolName) {
    case "list_connections": {
      const isDetailed = readString(input, "response_format") === "detailed";
      const accounts = world.accounts.map((account) => ({
        id: account.id,
        platform: account.platform,
        name: account.name,
        username: account.username,
        status: account.isAvailable ? "ok" : "needs_reconnect",
        ...(isDetailed ? { follower_count: account.followers, avatar_url: `https://cdn.sharetopus.com/avatars/${account.username}.png` } : {}),
      }));
      return okJson({ accounts, reconnect_url: RECONNECT_URL }, false);
    }
    case "list_pinterest_boards":
      return okJson({ boards: PINTEREST_BOARDS, bookmark: null }, false);
    case "list_posts":
      return runListPosts(world, input);
    case "list_billing_summary":
      return okJson({ plan: "Creator", status: "active", current_period_end: "2026-10-28T00:00:00Z", period: "2026-10", usage: [{ tool: "publish_posts", used: 16, limit: 500 }, { tool: "request_upload_url", used: 0, limit: 500 }, { tool: "attach_media_from_url", used: 3, limit: 500 }] }, false);
    case "get_account_analytics":
      return okJson({ metrics: ANALYTICS_ROWS }, false);
    case "attach_media_from_url": {
      const attached = attachMedia(world, readString(input, "url") ?? "");
      return attached ? okJson(attached, false) : failWith("Unsupported media type. Allowed: image/jpeg, image/png, video/mp4.");
    }
    case "request_upload_url":
      return okJson({ upload_url: "https://storage.example/upload?token=abc", storage_path: `${PRINCIPAL_ID}/upload-1.mp4`, token: "abc", expires_in_seconds: 7200 }, false);
    case "publish_posts":
      return runPublishPosts(world, input);
    case "update_scheduled_posts": {
      const action = readString(input, "action");
      if (action !== "cancel" && action !== "resume" && action !== "reschedule") return failWith("action must be cancel, resume or reschedule");
      const changeResult = changePosts(world, readStringArray(input, "post_ids"), action, readString(input, "scheduled_at") ?? null);
      if (!changeResult.ok) return failWith(changeResult.message);
      return okJson({ action, updated: changeResult.succeeded, skipped: changeResult.failed, message: `${changeResult.succeeded} post(s) updated.` }, false);
    }
    case "delete_scheduled_posts": {
      const changeResult = changePosts(world, readStringArray(input, "post_ids"), "delete", null);
      if (!changeResult.ok) return failWith(changeResult.message);
      return okJson({ deleted: changeResult.succeeded, skipped: changeResult.failed, message: `${changeResult.succeeded} post(s) deleted.` }, false);
    }
    default:
      return failWith(`Unknown tool ${toolName}.`);
  }
}
