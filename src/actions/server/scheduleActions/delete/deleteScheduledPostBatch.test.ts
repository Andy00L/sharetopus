import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

import type { PostStatus } from "@/db/schema";

type StoredPost = {
  id: string;
  principal_id: string;
  status: PostStatus;
  media_storage_path: string;
};

const PRINCIPAL_ID = "principal-1";

const CONDITION_PATTERN = /"scheduled_posts"\."(\w+)" (?:(<>) \$(\d+)|in \(([^)]*)\))/g;

const world: {
  posts: Map<string, StoredPost>;
  claimAfterRead: string | null;
  cleanedPaths: string[];
} = { posts: new Map(), claimAfterRead: null, cleanedPaths: [] };

function readStatement(query: unknown): { sql: string; params: unknown[] } {
  if (typeof query !== "object" || query === null || !("toSQL" in query)) {
    throw new Error("runQuery fake expects a drizzle query");
  }
  const toSql = query.toSQL;
  if (typeof toSql !== "function") throw new Error("runQuery fake expects toSQL()");
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

function matchesWhere(post: StoredPost, whereSql: string, params: unknown[]): boolean {
  return [...whereSql.matchAll(CONDITION_PATTERN)].every((conditionMatch) => {
    const [, column, notEqualOperator, paramIndex, inPlaceholders] = conditionMatch;
    const storedValue = column === "id" ? post.id : column === "status" ? post.status : null;
    if (storedValue === null) throw new Error(`Unexpected column ${column}`);
    if (notEqualOperator) return storedValue !== readParam(params, `$${paramIndex}`);
    return inPlaceholders
      .split(", ")
      .some((placeholder) => storedValue === readParam(params, placeholder));
  });
}

mock.module("server-only", () => ({}));

mock.module("@/actions/server/rateLimit/checkRateLimit", () => ({
  checkRateLimit: async () => ({ success: true }),
}));

mock.module("@/actions/server/data/storageFiles/deleteSupabaseFile", () => ({
  deleteUnreferencedMediaFiles: async (_principalId: string, filePaths: string[]) => {
    world.cleanedPaths.push(...filePaths);
    return { success: true, removedCount: filePaths.length, preservedCount: 0 };
  },
}));

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: unknown) => {
    const { sql, params } = readStatement(query);
    const whereSql = sql.split(" where ")[1] ?? "";
    const matchingPosts = [...world.posts.values()].filter((post) =>
      matchesWhere(post, whereSql, params),
    );
    if (sql.startsWith("select")) {
      const readPosts = matchingPosts.map((post) => ({ ...post }));
      if (world.claimAfterRead) {
        const claimedPost = world.posts.get(world.claimAfterRead);
        if (claimedPost) world.posts.set(claimedPost.id, { ...claimedPost, status: "processing" });
      }
      return { data: readPosts, error: null };
    }
    if (sql.startsWith('delete from "scheduled_posts"')) {
      for (const post of matchingPosts) world.posts.delete(post.id);
      return { data: matchingPosts, error: null };
    }
    throw new Error(`Unexpected statement: ${sql}`);
  },
}));

const { deleteScheduledPostBatch } = await import("./deleteScheduledPostBatch");
const { restPostBatchFailureResponse } = await import(
  "@/lib/api/rest/errors/restPostBatchFailureResponse"
);

function storePost(id: string, status: PostStatus): void {
  world.posts.set(id, {
    id,
    principal_id: PRINCIPAL_ID,
    status,
    media_storage_path: `${PRINCIPAL_ID}/${id}.mp4`,
  });
}

function deletePosts(postIds: string[]) {
  return deleteScheduledPostBatch(postIds, PRINCIPAL_ID, "api", "req-1");
}

beforeEach(() => {
  world.posts = new Map();
  world.claimAfterRead = null;
  world.cleanedPaths = [];
});

describe("deleting a post that is publishing now", () => {
  test("is refused with a message to try again, and the post stays", async () => {
    storePost("post-1", "processing");
    const result = await deletePosts(["post-1"]);
    expect(result).toEqual({
      success: false,
      failure: "not_eligible",
      message: "Post post-1 is publishing now. Try again in a minute.",
    });
    expect(world.posts.has("post-1")).toBe(true);
    expect(world.cleanedPaths).toEqual([]);
  });

  test("refuses the whole batch when one of its posts is publishing", async () => {
    storePost("post-1", "scheduled");
    storePost("post-2", "processing");
    const result = await deletePosts(["post-1", "post-2"]);
    expect(result).toMatchObject({ success: false, failure: "not_eligible" });
    expect([...world.posts.keys()]).toEqual(["post-1", "post-2"]);
  });

  test("keeps a post a run claims between the read and the delete, and deletes the rest", async () => {
    storePost("post-1", "scheduled");
    storePost("post-2", "scheduled");
    world.claimAfterRead = "post-2";
    const result = await deletePosts(["post-1", "post-2"]);
    expect(result).toMatchObject({
      success: true,
      message: "Deleted 1 post(s).",
      details: { total: 2, succeeded: 1, failed: 1 },
    });
    expect([...world.posts.keys()]).toEqual(["post-2"]);
    expect(world.cleanedPaths).toEqual([`${PRINCIPAL_ID}/post-1.mp4`]);
  });

  test("the REST API answers the refusal with 409 conflict", async () => {
    storePost("post-1", "processing");
    const result = await deletePosts(["post-1"]);
    if (result.success) throw new Error("expected a refusal");
    const response = restPostBatchFailureResponse(result, "req-1");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "conflict", message: "Post post-1 is publishing now. Try again in a minute." },
    });
  });
});

describe("deleting posts in any other status", () => {
  test("deletes them and checks their media for cleanup", async () => {
    storePost("post-1", "scheduled");
    storePost("post-2", "posted");
    storePost("post-3", "failed");
    storePost("post-4", "cancelled");
    const result = await deletePosts(["post-1", "post-2", "post-3", "post-4"]);
    expect(result).toMatchObject({ success: true, details: { succeeded: 4, failed: 0 } });
    expect(world.posts.size).toBe(0);
    expect(world.cleanedPaths).toHaveLength(4);
  });
});
