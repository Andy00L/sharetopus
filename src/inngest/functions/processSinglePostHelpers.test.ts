import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

type StoredPost = {
  id: string;
  status: string;
  scheduled_at: string;
  cancelled_by_sub_at: string | null;
};

type AccessRows = {
  subscriptions: { stripe_price_id: string | null; status: string; current_period_end: string | null; start_date: string | null }[];
  users: { creator_access_until: string | null }[];
  isReadFailing: boolean;
};

type ColumnCondition = { column: string; allowedValues: unknown[] };

const POST_ID = "post-1";
const FIRST_TIME = "2026-11-20T10:00:00+00:00";
const SECOND_TIME = "2026-11-20T12:30:00+00:00";

const postStore = new Map<string, StoredPost>();

const accessRows: AccessRows = { subscriptions: [], users: [], isReadFailing: false };

const WHERE_CONDITION_PATTERN =
  /"scheduled_posts"\."(\w+)" (?:= \$(\d+)|in \(([^)]*)\))/g;
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

function readWhereConditions(whereSql: string, params: unknown[]): ColumnCondition[] {
  return [...whereSql.matchAll(WHERE_CONDITION_PATTERN)].map((conditionMatch) => {
    const [, column, equalsIndex, inPlaceholders] = conditionMatch;
    const allowedValues = equalsIndex
      ? [params[Number(equalsIndex) - 1]]
      : inPlaceholders.split(", ").map((placeholder) => readParam(params, placeholder));
    return { column, allowedValues };
  });
}

function isSameStoredValue(column: string, storedValue: string, wantedValue: unknown): boolean {
  if (typeof wantedValue !== "string") return false;
  return column === "scheduled_at"
    ? Date.parse(storedValue) === Date.parse(wantedValue)
    : storedValue === wantedValue;
}

function readStoredValue(storedPost: StoredPost, column: string): string {
  switch (column) {
    case "id":
      return storedPost.id;
    case "status":
      return storedPost.status;
    case "scheduled_at":
      return storedPost.scheduled_at;
    default:
      throw new Error(`Unknown column ${column}`);
  }
}

function matchesConditions(storedPost: StoredPost, conditions: ColumnCondition[]): boolean {
  return conditions.every((condition) => {
    const storedValue = readStoredValue(storedPost, condition.column);
    return condition.allowedValues.some((wantedValue) =>
      isSameStoredValue(condition.column, storedValue, wantedValue),
    );
  });
}

function runUpdate(sql: string, params: unknown[]): { id: string }[] {
  const [setSql, whereSql] = sql.split(" where ");
  const conditions = readWhereConditions(whereSql, params);
  const assignments = [...setSql.matchAll(SET_ASSIGNMENT_PATTERN)];
  return [...postStore.values()]
    .filter((storedPost) => matchesConditions(storedPost, conditions))
    .map((storedPost) => {
      let updatedPost = storedPost;
      for (const [, column, paramIndex] of assignments) {
        const assignedValue = params[Number(paramIndex) - 1];
        if (column === "status" && typeof assignedValue === "string") {
          updatedPost = { ...updatedPost, status: assignedValue };
        }
        if (column === "cancelled_by_sub_at" && typeof assignedValue === "string") {
          updatedPost = { ...updatedPost, cancelled_by_sub_at: assignedValue };
        }
      }
      postStore.set(storedPost.id, updatedPost);
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

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: unknown) => {
    const { sql, params } = readSqlStatement(query);
    if (sql.includes('from "stripe_subscriptions"') || sql.includes('from "users"')) {
      if (accessRows.isReadFailing) {
        return { data: null, error: { message: "connection reset", code: "08006" } };
      }
      const rows = sql.includes('from "users"') ? accessRows.users : accessRows.subscriptions;
      return { data: rows, error: null };
    }
    if (!sql.startsWith('update "scheduled_posts"')) {
      throw new Error(`Unexpected statement: ${sql}`);
    }
    return { data: runUpdate(sql, params), error: null };
  },
}));

const { claimPostForProcessing, cleanupMediaIfUnreferenced, gatePostOnOwnerAccess } = await import(
  "./processSinglePostHelpers"
);

function storePost(changes: Partial<StoredPost>): void {
  postStore.set(POST_ID, {
    id: POST_ID,
    status: "scheduled",
    scheduled_at: FIRST_TIME,
    cancelled_by_sub_at: null,
    ...changes,
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
  accessRows.subscriptions = [];
  accessRows.users = [];
  accessRows.isReadFailing = false;
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
