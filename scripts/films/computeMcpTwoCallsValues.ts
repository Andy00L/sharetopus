// Computes every value the mcp-two-calls film shows by running its three calls on the eval mock
// account (Pinterest removed, so three accounts remain). Writes mcp-two-calls.values.json here.
// Run: bun scripts/films/computeMcpTwoCallsValues.ts
import { writeFile } from "node:fs/promises";

import { ACCOUNT_IDS, createMockWorld, isJsonObject, runMockTool, type JsonObject } from "../mcp-evals/mockWorld";

/** Friday 09:00 in Toronto (EDT, UTC-4), the Bluesky post's scheduled time. */
const BLUESKY_SCHEDULED_AT = "2026-10-09T09:00:00-04:00";
const POST_TEXT = "We ship on Friday";

function parseToolJson(toolName: string, text: string): JsonObject {
  const parsed: unknown = JSON.parse(text);
  if (!isJsonObject(parsed)) {
    console.error(`[computeMcpTwoCallsValues] ${toolName} did not return an object`);
    process.exit(1);
  }
  return parsed;
}

function readArray(value: JsonObject, key: string): JsonObject[] {
  const field = value[key];
  return Array.isArray(field) ? field.filter(isJsonObject) : [];
}

/** First 4 and last 4 characters, the ledger truncation rule (docs/UI_DESIGN_SYSTEM.md). */
function truncateMiddle(value: string): string {
  return value.length > 10 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
}

function formatTorontoTime(isoTime: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(isoTime));
}

async function computeMcpTwoCallsValues(): Promise<void> {
  const world = createMockWorld();
  world.accounts = world.accounts.filter((account) => account.platform !== "pinterest");

  const connections = runMockTool(world, "after", "list_connections", {});
  const publish = runMockTool(world, "after", "publish_posts", {
    posts: [
      { social_account_id: ACCOUNT_IDS.linkedin, post_type: "text", description: POST_TEXT },
      { social_account_id: ACCOUNT_IDS.bluesky, post_type: "text", description: POST_TEXT, scheduled_at: BLUESKY_SCHEDULED_AT },
    ],
  });
  if (connections.isError || publish.isError) {
    console.error("[computeMcpTwoCallsValues] a call failed:", connections.text, publish.text);
    process.exit(1);
  }
  const publishResult = parseToolJson("publish_posts", publish.text);
  const batchId = typeof publishResult.batch_id === "string" ? publishResult.batch_id : "";
  const listed = runMockTool(world, "after", "list_posts", { batch_id: batchId });

  const values = {
    computedAt: new Date().toISOString(),
    postText: POST_TEXT,
    accounts: readArray(parseToolJson("list_connections", connections.text), "accounts").map((account) => ({
      platform: account.platform,
      name: account.name,
      status: account.status,
    })),
    publish: {
      batchId,
      batchIdShort: truncateMiddle(batchId),
      publishingNow: publishResult.publishing_now,
      scheduled: publishResult.scheduled,
      blueskyScheduledAt: BLUESKY_SCHEDULED_AT,
      blueskyScheduledLabel: `${formatTorontoTime(BLUESKY_SCHEDULED_AT)} ET`,
    },
    listedPosts: readArray(parseToolJson("list_posts", listed.text), "posts").map((post) => ({
      platform: post.platform,
      status: post.status,
    })),
    calls: { toPost: 2, toCheck: 1 },
  };

  const outPath = new URL("./mcp-two-calls.values.json", import.meta.url);
  await writeFile(outPath, `${JSON.stringify(values, null, 2)}\n`);
  console.log(`[computeMcpTwoCallsValues] ${JSON.stringify(values)}`);
}

await computeMcpTwoCallsValues();
