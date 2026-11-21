import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

import type { scheduled_posts } from "@/db/schema";

type StoredPost = {
  id: string;
  status: string;
  scheduled_at: string;
  updated_at: string;
  publish_started_at: string | null;
  cancelled_by_sub_at: string | null;
  error_message: string | null;
};

type AccessRows = {
  subscriptions: { stripe_price_id: string | null; status: string; current_period_end: string | null; start_date: string | null }[];
  users: { creator_access_until: string | null }[];
  isReadFailing: boolean;
};

const POST_ID = "post-1";
const FIRST_TIME = "2026-11-20T10:00:00+00:00";
const SECOND_TIME = "2026-11-20T12:30:00+00:00";
const DB_NOW = "2026-11-20T14:00:00.000Z";
const SETTLE_CUTOFF = "2026-11-20T12:00:00.000Z";

const postStore = new Map<string, StoredPost>();

const accessRows: AccessRows = { subscriptions: [], users: [], isReadFailing: false };

const TIME_COLUMNS = new Set(["scheduled_at", "updated_at", "publish_started_at"]);
const WHERE_TOKEN_PATTERN =
  /"scheduled_posts"\."\w+" (?:is null|(?:=|<>|<) \$\d+|in \([^)]*\))|\(|\)|\band\b|\bor\b/g;
const ATOM_PATTERN = /^"scheduled_posts"\."(\w+)" (is null|=|<>|<|in) ?(?:\$(\d+)|\(([^)]*)\))?$/;
const SET_ASSIGNMENT_PATTERN = /"(\w+)" = \$(\d+)/g;

function readSqlStatement(query: unknown): { sql: string; params: unknown[] } {
  if (typeof query !== "object" || query === null || !("toSQL" in query)) {
    throw new Error("runQuery mock expects a drizzle query");
  }
  const toSql = query.toSQL;
  if (typeof toSql !== "function") throw new Error("runQuery mock expects toSQL()");
  const statement: unknown = toSql.call(query);
  if (
    typeof statement !== "object" ||
    statement === null ||
    !("sql" in statement) ||
    !("params" in statement) ||
    typeof statement.sql !== "string" ||
    !Array.isArray(statement.params)
  ) {
    throw new Error("toSQL() returned an unexpected shape");
  }
  return { sql: statement.sql, params: statement.params };
}

function readParam(params: unknown[], placeholder: string): unknown {
  return params[Number(placeholder.replace("$", "")) - 1];
}

function readStoredValue(storedPost: StoredPost, column: string): string | null {
  switch (column) {
    case "id":
    case "status":
    case "scheduled_at":
    case "updated_at":
    case "publish_started_at":
      return storedPost[column];
    default:
      throw new Error(`Unknown column ${column}`);
  }
}

function compareStoredValue(column: string, storedValue: string, wantedValue: unknown): number {
  if (typeof wantedValue !== "string") throw new Error(`Unexpected param for ${column}`);
  if (TIME_COLUMNS.has(column)) return Date.parse(storedValue) - Date.parse(wantedValue);
  return storedValue === wantedValue ? 0 : 1;
}

function evaluateAtom(atomSql: string, storedPost: StoredPost, params: unknown[]): boolean {
  const atomMatch = ATOM_PATTERN.exec(atomSql);
  if (!atomMatch) throw new Error(`Unexpected condition: ${atomSql}`);
  const [, column, operator, paramIndex, inPlaceholders] = atomMatch;
  const storedValue = readStoredValue(storedPost, column);
  if (operator === "is null") return storedValue === null;
  if (storedValue === null) return false;
  if (operator === "in") {
    return inPlaceholders
      .split(", ")
      .some((placeholder) => compareStoredValue(column, storedValue, readParam(params, placeholder)) === 0);
  }
  const comparison = compareStoredValue(column, storedValue, params[Number(paramIndex) - 1]);
  if (operator === "=") return comparison === 0;
  if (operator === "<>") return comparison !== 0;
  return comparison < 0;
}

// drizzle wraps every and()/or() group in parentheses and never mixes the
// two connectives inside one group.
function matchesWhere(whereSql: string, storedPost: StoredPost, params: unknown[]): boolean {
  const tokens = whereSql.match(WHERE_TOKEN_PATTERN) ?? [];
  let position = 0;
  const readOperand = (): boolean => {
    const token = tokens[position];
    position += 1;
    if (token !== "(") return evaluateAtom(token, storedPost, params);
    const groupValue = readGroup();
    position += 1;
    return groupValue;
  };
  const readGroup = (): boolean => {
    let groupValue = readOperand();
    while (tokens[position] === "and" || tokens[position] === "or") {
      const connective = tokens[position];
      position += 1;
      const operandValue = readOperand();
      groupValue = connective === "and" ? groupValue && operandValue : groupValue || operandValue;
    }
    return groupValue;
  };
  return readGroup();
}

function readWhereSql(sql: string): string {
  return (sql.split(" where ")[1] ?? "").split(/ returning | limit | order by /)[0];
}

function selectRows(sql: string, params: unknown[]): StoredPost[] {
  const whereSql = readWhereSql(sql);
  return [...postStore.values()].filter((storedPost) => matchesWhere(whereSql, storedPost, params));
}

function assignColumn(storedPost: StoredPost, column: string, assignedValue: unknown): StoredPost {
  const nullableValue = typeof assignedValue === "string" ? assignedValue : null;
  switch (column) {
    case "status":
      return typeof assignedValue === "string" ? { ...storedPost, status: assignedValue } : storedPost;
    case "cancelled_by_sub_at":
    case "error_message":
    case "publish_started_at":
      return { ...storedPost, [column]: nullableValue };
    default:
      return storedPost;
  }
}

// The on_scheduled_posts_update trigger sets updated_at = now() on every
// UPDATE (public.handle_updated_at).
function runUpdate(sql: string, params: unknown[]): { id: string }[] {
  const setSql = sql.split(" where ")[0];
  const assignments = [...setSql.matchAll(SET_ASSIGNMENT_PATTERN)];
  return selectRows(sql, params).map((storedPost) => {
    let updatedPost = storedPost;
    for (const [, column, paramIndex] of assignments) {
      updatedPost = assignColumn(updatedPost, column, params[Number(paramIndex) - 1]);
    }
    postStore.set(storedPost.id, { ...updatedPost, updated_at: DB_NOW });
    return { id: storedPost.id };
  });
}

mock.module("server-only", () => ({}));

mock.module("@/actions/api/adminSupabase", () => ({ adminSupabase: {} }));

const storageState: {
  deleteResult: { success: true; removed: boolean; message: string } | { success: false; message: string };
} = { deleteResult: { success: true, removed: true, message: "File deleted successfully." } };

mock.module("@/actions/server/data/storageFiles/deleteSupabaseFile", () => ({
  deleteSupabaseFile: async () => storageState.deleteResult,
}));

const historyState: { publishedPostIds: Set<string>; isReadFailing: boolean } = {
  publishedPostIds: new Set(),
  isReadFailing: false,
};

const failedPostRecords: { batch_id: string }[] = [];

mock.module("@/actions/server/contentHistoryActions/storeFailedPost", () => ({
  storeFailedPost: async (record: { batch_id: string }) => {
    failedPostRecords.push(record);
    return { success: true, message: "stored" };
  },
}));

const sentWebhooks: { eventType: string; payload: Record<string, unknown> }[] = [];

mock.module("@/lib/api/rest/webhooks/dispatch", () => ({
  dispatchWebhook: async (_principalId: string, eventType: string, payload: Record<string, unknown>) => {
    sentWebhooks.push({ eventType, payload });
  },
}));

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: unknown) => {
    const { sql, params } = readSqlStatement(query);
    if (sql.includes('from "content_history"')) {
      if (historyState.isReadFailing) {
        return { data: null, error: { message: "connection reset", code: "08006" } };
      }
      const scheduledPostId = params[1];
      return {
        data: typeof scheduledPostId === "string" && historyState.publishedPostIds.has(scheduledPostId)
          ? [{ id: "history-1" }]
          : [],
        error: null,
      };
    }
    if (sql.includes('from "stripe_subscriptions"') || sql.includes('from "users"')) {
      if (accessRows.isReadFailing) {
        return { data: null, error: { message: "connection reset", code: "08006" } };
      }
      const rows = sql.includes('from "users"') ? accessRows.users : accessRows.subscriptions;
      return { data: rows, error: null };
    }
    if (sql.startsWith("select") && sql.includes('from "scheduled_posts"')) {
      return { data: selectRows(sql, params), error: null };
    }
    if (!sql.startsWith('update "scheduled_posts"')) {
      throw new Error(`Unexpected statement: ${sql}`);
    }
    if (writeState.isUpdateFailing) {
      return { data: null, error: { message: "connection reset", code: "08006" } };
    }
    return { data: runUpdate(sql, params), error: null };
  },
}));

const writeState = { isUpdateFailing: false };

const {
  claimPostForProcessing,
  claimPublishAttempt,
  cleanupMediaIfUnreferenced,
  finalizeProcessingPost,
  gatePostOnOwnerAccess,
  releasePublishAttempt,
} = await import("./processSinglePostHelpers");

function storePost(changes: Partial<StoredPost>): void {
  postStore.set(POST_ID, {
    id: POST_ID,
    status: "scheduled",
    scheduled_at: FIRST_TIME,
    updated_at: FIRST_TIME,
    publish_started_at: null,
    cancelled_by_sub_at: null,
    error_message: null,
    ...changes,
  });
}

function buildScheduledPostRow(): typeof scheduled_posts.$inferSelect {
  return {
    id: POST_ID,
    principal_id: "principal-1",
    social_account_id: "account-1",
    platform: "linkedin",
    status: "processing",
    scheduled_at: FIRST_TIME,
    posted_at: null,
    scheduled_at_date: null,
    post_title: null,
    post_description: "Hello",
    post_options: {},
    media_type: "text",
    media_storage_path: "",
    cover_image_timestamp: null,
    batch_id: "batch-1",
    error_message: null,
    retry_count: 0,
    created_via: "web",
    idempotency_key: null,
    x402_charge_id: null,
    metadata: null,
    created_at: FIRST_TIME,
    updated_at: FIRST_TIME,
    cancelled_by_sub_at: null,
    publish_started_at: null,
  };
}

function finalizeStuckPost(abandonedClaimBeforeIso: string | null) {
  return finalizeProcessingPost({
    post: buildScheduledPostRow(),
    failureMessage: "Publishing stopped without a result; the post may have published",
    abandonedClaimBeforeIso,
  });
}

function gateForEventTime(eventScheduledAt: string, createdVia: "web" | "x402" = "web") {
  return gatePostOnOwnerAccess({
    post: { id: POST_ID, principal_id: "principal-1", created_via: createdVia },
    dispatchedScheduledAt: eventScheduledAt,
  });
}

async function claimForEventTime(eventScheduledAt: string): Promise<boolean> {
  const claim = await claimPostForProcessing({
    scheduledPostId: POST_ID,
    dispatchedScheduledAt: eventScheduledAt,
  });
  if (!claim.success) throw new Error(claim.message);
  return claim.claimed;
}

beforeEach(() => {
  postStore.clear();
  historyState.publishedPostIds = new Set();
  historyState.isReadFailing = false;
  failedPostRecords.length = 0;
  sentWebhooks.length = 0;
  accessRows.subscriptions = [];
  accessRows.users = [];
  accessRows.isReadFailing = false;
  writeState.isUpdateFailing = false;
});

describe("a post.due run re-checks the row before it claims it", () => {
  test("the run for the original time does nothing after a reschedule", async () => {
    storePost({ scheduled_at: SECOND_TIME });
    expect(await claimForEventTime(FIRST_TIME)).toBe(false);
    expect(postStore.get(POST_ID)?.status).toBe("scheduled");
    expect(await claimForEventTime(SECOND_TIME)).toBe(true);
  });

  test("the run does nothing after a cancel", async () => {
    storePost({ status: "cancelled" });
    expect(await claimForEventTime(FIRST_TIME)).toBe(false);
    expect(postStore.get(POST_ID)?.status).toBe("cancelled");
  });

  test("a post resumed at its original time is claimed by the pending run", async () => {
    storePost({ status: "cancelled" });
    storePost({ status: "scheduled" });
    expect(await claimForEventTime(FIRST_TIME)).toBe(true);
  });

  test("a row left queued by the old dispatcher is still claimed", async () => {
    storePost({ status: "queued" });
    expect(await claimForEventTime(FIRST_TIME)).toBe(true);
  });

  test("only the first of two runs for the same time claims the row", async () => {
    storePost({});
    expect(await claimForEventTime(FIRST_TIME)).toBe(true);
    expect(await claimForEventTime("2026-11-20T10:00:00.000Z")).toBe(false);
    expect(postStore.get(POST_ID)?.status).toBe("processing");
  });
});

describe("the access gate before a claim", () => {
  test("pauses the post like a subscription cancel when its owner has neither a plan nor referral weeks", async () => {
    storePost({ status: "queued" });
    accessRows.users = [{ creator_access_until: "2026-01-01T00:00:00.000Z" }];
    const gate = await gateForEventTime(FIRST_TIME);
    expect(gate).toEqual({ success: true, isOpen: false, isPaused: true });
    const pausedPost = postStore.get(POST_ID);
    expect(pausedPost?.status).toBe("cancelled");
    expect(pausedPost?.cancelled_by_sub_at).not.toBeNull();
  });

  test("a past_due plan grants nothing, so the post is paused", async () => {
    storePost({});
    accessRows.subscriptions = [{ stripe_price_id: null, status: "past_due", current_period_end: null, start_date: null }];
    expect(await gateForEventTime(FIRST_TIME)).toEqual({ success: true, isOpen: false, isPaused: true });
  });

  test("leaves the row alone and opens when the owner has an active plan or referral weeks", async () => {
    storePost({});
    accessRows.subscriptions = [{ stripe_price_id: null, status: "trialing", current_period_end: null, start_date: null }];
    expect(await gateForEventTime(FIRST_TIME)).toEqual({ success: true, isOpen: true });

    accessRows.subscriptions = [];
    accessRows.users = [{ creator_access_until: new Date(Date.now() + 86_400_000).toISOString() }];
    expect(await gateForEventTime(FIRST_TIME)).toEqual({ success: true, isOpen: true });
    expect(postStore.get(POST_ID)?.status).toBe("scheduled");
  });

  test("an unreadable access state stays closed and changes nothing", async () => {
    storePost({});
    accessRows.isReadFailing = true;
    const gate = await gateForEventTime(FIRST_TIME);
    expect(gate.success).toBe(false);
    expect(postStore.get(POST_ID)).toMatchObject({ status: "scheduled", cancelled_by_sub_at: null });
  });

  test("does not pause a post rescheduled since dispatch", async () => {
    storePost({ scheduled_at: SECOND_TIME });
    const gate = await gateForEventTime(FIRST_TIME);
    expect(gate).toEqual({ success: true, isOpen: false, isPaused: false });
    expect(postStore.get(POST_ID)?.status).toBe("scheduled");
  });

  test("an x402 post was paid for and opens without reading the owner's plan", async () => {
    storePost({});
    accessRows.isReadFailing = true;
    expect(await gateForEventTime(FIRST_TIME, "x402")).toEqual({ success: true, isOpen: true });
  });
});

describe("cleanupMediaIfUnreferenced", () => {
  test("reports a file kept for another post as not deleted", async () => {
    storageState.deleteResult = {
      success: true,
      removed: false,
      message: "Cannot delete: This file is still used by a post or a publish in progress.",
    };
    const kept = await cleanupMediaIfUnreferenced("principal-1/clip.mp4", "principal-1");
    expect(kept.deleted).toBe(false);

    storageState.deleteResult = { success: true, removed: true, message: "File deleted successfully." };
    const removed = await cleanupMediaIfUnreferenced("principal-1/clip.mp4", "principal-1");
    expect(removed.deleted).toBe(true);
  });
});

describe("finalizeProcessingPost settles a post no run will settle", () => {
  test("a post with a content_history row is recorded posted, not failed", async () => {
    storePost({ status: "processing" });
    historyState.publishedPostIds = new Set([POST_ID]);
    const finalized = await finalizeStuckPost(null);
    expect(finalized).toEqual({ success: true, outcome: { ok: true, contentId: POST_ID }, updated: true });
    expect(postStore.get(POST_ID)?.status).toBe("posted");
    expect(failedPostRecords).toEqual([]);
  });

  test("a post without one is recorded failed with a message that it may have published", async () => {
    storePost({ status: "processing" });
    const finalized = await finalizeStuckPost(null);
    expect(finalized.success).toBe(true);
    expect(postStore.get(POST_ID)?.status).toBe("failed");
    expect(postStore.get(POST_ID)?.error_message).toContain("may have published");
    expect(failedPostRecords.map((record) => record.batch_id)).toEqual(["batch-1"]);
  });

  test("a post recorded failed fires post.failed that says it may have published", async () => {
    storePost({ status: "processing" });
    await finalizeStuckPost(null);
    expect(sentWebhooks).toEqual([
      {
        eventType: "post.failed",
        payload: {
          post_id: POST_ID,
          platform: "linkedin",
          reason: "transient",
          error_message: "Publishing stopped without a result; the post may have published",
          may_have_published: true,
        },
      },
    ]);
  });

  test("a history read that fails changes nothing and reports the failure", async () => {
    storePost({ status: "processing" });
    historyState.isReadFailing = true;
    const finalized = await finalizeStuckPost(null);
    expect(finalized).toEqual({
      success: false,
      message: "content history lookup failed: connection reset",
    });
    expect(postStore.get(POST_ID)?.status).toBe("processing");
  });

  test("a post another writer settled first is left as it is", async () => {
    storePost({ status: "posted" });
    const finalized = await finalizeStuckPost(null);
    expect(finalized).toMatchObject({ success: true, updated: false });
    expect(postStore.get(POST_ID)?.status).toBe("posted");
    expect(failedPostRecords).toEqual([]);
  });
});

describe("the publish claim taken right before the platform call", () => {
  test("the first attempt claims the post, a retry finds the claim held", async () => {
    storePost({ status: "processing" });
    expect(await claimPublishAttempt(POST_ID)).toEqual({ success: true, kind: "claimed" });
    expect(postStore.get(POST_ID)?.publish_started_at).not.toBeNull();
    expect(await claimPublishAttempt(POST_ID)).toEqual({
      success: true,
      kind: "attempt-already-started",
    });
  });

  test("a post that is gone or no longer processing is never claimed", async () => {
    expect(await claimPublishAttempt(POST_ID)).toEqual({ success: true, kind: "post-deleted" });
    storePost({ status: "failed" });
    expect(await claimPublishAttempt(POST_ID)).toEqual({
      success: true,
      kind: "post-no-longer-processing",
    });
    expect(postStore.get(POST_ID)?.publish_started_at).toBeNull();
  });

  test("a released claim lets the retry claim the post again", async () => {
    storePost({ status: "processing" });
    await claimPublishAttempt(POST_ID);
    expect(await releasePublishAttempt(POST_ID)).toEqual({ success: true });
    expect(await claimPublishAttempt(POST_ID)).toEqual({ success: true, kind: "claimed" });
  });

  test("a claim the database refuses is reported and claims nothing", async () => {
    storePost({ status: "processing" });
    writeState.isUpdateFailing = true;
    expect(await claimPublishAttempt(POST_ID)).toMatchObject({ success: false });
    expect(postStore.get(POST_ID)?.publish_started_at).toBeNull();
  });

  test("a run that claims the post for processing starts with no publish claim", async () => {
    storePost({ publish_started_at: "2026-11-19T09:00:00.000Z" });
    expect(await claimForEventTime(FIRST_TIME)).toBe(true);
    expect(postStore.get(POST_ID)?.publish_started_at).toBeNull();
  });
});

describe("a settler never overrides a publish attempt that holds the claim", () => {
  test("the failure handler leaves a post with a held claim in processing", async () => {
    storePost({ status: "processing", publish_started_at: "2026-11-20T13:59:00.000Z" });
    expect(await finalizeStuckPost(null)).toMatchObject({ success: true, updated: false });
    expect(postStore.get(POST_ID)?.status).toBe("processing");
    expect(failedPostRecords).toEqual([]);
  });

  test("the hourly safety net skips a claim taken after its cutoff and settles an older one", async () => {
    storePost({ status: "processing", publish_started_at: "2026-11-20T13:59:00.000Z" });
    expect(await finalizeStuckPost(SETTLE_CUTOFF)).toMatchObject({ success: true, updated: false });
    expect(postStore.get(POST_ID)?.status).toBe("processing");

    storePost({ status: "processing", publish_started_at: "2026-11-20T10:05:00.000Z" });
    expect(await finalizeStuckPost(SETTLE_CUTOFF)).toMatchObject({ success: true, updated: true });
    expect(postStore.get(POST_ID)?.status).toBe("failed");
  });
});
