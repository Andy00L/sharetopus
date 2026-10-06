// Plays a correct call sequence for every task on both tool sets and checks the graders accept
// it, so the mock world and the checks are proven before any paid eval run.
// Run: bun scripts/mcp-evals/selfTest.ts
import { ACCOUNT_IDS, FALL_BOARD_ID, SEED_POST_IDS, createMockWorld, runMockTool, type JsonObject, type MockWorld, type ToolSetVersion } from "./mockWorld";
import { EVAL_TASKS } from "./tasks";

type PlannedCall = (world: MockWorld) => { tool: string; input: JsonObject };
type OraclePlan = { calls: PlannedCall[]; finalText: string };

const FRIDAY_IDS = [SEED_POST_IDS.fridayTips, SEED_POST_IDS.fridayStream];
const call = (tool: string, input: JsonObject): PlannedCall => () => ({ tool, input });
const latestUpload = (world: MockWorld) => world.uploadedPaths.at(-1) ?? "";

/** The intended solution of each task, per tool set. */
const ORACLE_PLANS: Record<string, Record<ToolSetVersion, OraclePlan>> = {
  "text-now": {
    before: { calls: [call("post_now", { social_account_id: ACCOUNT_IDS.bluesky, platform: "bluesky", post_type: "text", description: "We ship on Friday" })], finalText: "Posted." },
    after: { calls: [call("publish_posts", { posts: [{ social_account_id: ACCOUNT_IDS.bluesky, post_type: "text", description: "We ship on Friday" }] })], finalText: "Posted." },
  },
  "cross-post-media": {
    before: {
      calls: [
        call("attach_media_from_url", { url: "https://cdn.example.com/fall.jpg" }),
        (world) => ({ tool: "bulk_schedule", input: { posts: [
          { social_account_id: ACCOUNT_IDS.pinterest, platform: "pinterest", post_type: "image", description: "Fall launch is here", media_storage_path: latestUpload(world), pinterest_board_id: FALL_BOARD_ID, scheduled_at: "2026-10-08T10:00:00-04:00" },
          { social_account_id: ACCOUNT_IDS.linkedin, platform: "linkedin", post_type: "image", description: "Fall launch is here", media_storage_path: latestUpload(world), scheduled_at: "2026-10-08T10:00:00-04:00" },
        ] } }),
      ],
      finalText: "Scheduled.",
    },
    after: {
      calls: [
        call("attach_media_from_url", { url: "https://cdn.example.com/fall.jpg" }),
        (world) => ({ tool: "publish_posts", input: { posts: [
          { social_account_id: ACCOUNT_IDS.pinterest, post_type: "image", description: "Fall launch is here", media_storage_path: latestUpload(world), pinterest_board_id: FALL_BOARD_ID, scheduled_at: "2026-10-08T10:00:00-04:00" },
          { social_account_id: ACCOUNT_IDS.linkedin, post_type: "image", description: "Fall launch is here", media_storage_path: latestUpload(world), scheduled_at: "2026-10-08T10:00:00-04:00" },
        ] } }),
      ],
      finalText: "Scheduled.",
    },
  },
  "cancel-friday": {
    before: { calls: [call("list_scheduled_posts", { status: "scheduled" }), call("cancel_scheduled_posts", { post_ids: FRIDAY_IDS })], finalText: "Cancelled." },
    after: { calls: [call("list_posts", { from: "2026-10-09T00:00:00Z", to: "2026-10-09T23:59:59Z" }), call("update_scheduled_posts", { post_ids: FRIDAY_IDS, action: "cancel" })], finalText: "Cancelled." },
  },
  "reschedule-friday": {
    before: { calls: [call("reschedule_posts", { post_ids: FRIDAY_IDS, new_scheduled_time: "2026-10-12T09:00:00Z" })], finalText: "Moved." },
    after: { calls: [call("update_scheduled_posts", { post_ids: FRIDAY_IDS, action: "reschedule", scheduled_at: "2026-10-12T09:00:00Z" })], finalText: "Moved." },
  },
  "needs-reconnect": {
    before: { calls: [call("list_connections", { include_unavailable: true }), call("request_account_reauth_link", { social_account_id: ACCOUNT_IDS.tiktok })], finalText: "TikTok (andycreates) needs reconnecting at https://sharetopus.com/connections." },
    after: { calls: [call("list_connections", {})], finalText: "TikTok (andycreates) needs reconnecting at https://sharetopus.com/connections." },
  },
  "linkedin-history": {
    before: { calls: [call("list_content_history", { platform: "linkedin" })], finalText: "Launch week recap; Why we picked Postgres." },
    after: { calls: [call("list_posts", { status: "published", platform: "linkedin" })], finalText: "Launch week recap; Why we picked Postgres." },
  },
  "delete-old-promo": {
    before: { calls: [call("delete_scheduled_posts", { post_ids: [SEED_POST_IDS.oldPromo] })], finalText: "Deleted." },
    after: { calls: [call("delete_scheduled_posts", { post_ids: [SEED_POST_IDS.oldPromo] })], finalText: "Deleted." },
  },
  "broadcast-text": {
    before: { calls: [call("bulk_post_now", { posts: [
      { social_account_id: ACCOUNT_IDS.linkedin, platform: "linkedin", post_type: "text", description: "Hello from Sharetopus" },
      { social_account_id: ACCOUNT_IDS.bluesky, platform: "bluesky", post_type: "text", description: "Hello from Sharetopus" },
    ] })], finalText: "Posted." },
    after: { calls: [call("publish_posts", { posts: [
      { social_account_id: ACCOUNT_IDS.linkedin, post_type: "text", description: "Hello from Sharetopus" },
      { social_account_id: ACCOUNT_IDS.bluesky, post_type: "text", description: "Hello from Sharetopus" },
    ] })], finalText: "Posted." },
  },
};

/** Also proves a wrong answer fails: posting the broadcast to Pinterest must be rejected. */
function checkRejectsTextOnPinterest(): boolean {
  const world = createMockWorld();
  const toolResult = runMockTool(world, "after", "publish_posts", { posts: [{ social_account_id: ACCOUNT_IDS.pinterest, post_type: "text", description: "Hi" }] });
  return toolResult.isError && world.posts.every((post) => post.isSeed);
}

let failures = 0;
for (const task of EVAL_TASKS) {
  for (const version of ["before", "after"] as const) {
    const plan = ORACLE_PLANS[task.id]?.[version];
    if (!plan) {
      console.error(`[selfTest] ${task.id} ${version}: no oracle plan`);
      failures++;
      continue;
    }
    const world = createMockWorld();
    const toolErrors: string[] = [];
    // Sequential on purpose: a later call reads what an earlier one stored (the upload path).
    for (const plannedCall of plan.calls) {
      const plannedStep = plannedCall(world);
      const toolResult = runMockTool(world, version, plannedStep.tool, plannedStep.input);
      if (toolResult.isError) toolErrors.push(`${plannedStep.tool}: ${toolResult.text}`);
    }
    const verdict = task.check(world, plan.finalText);
    const isPassing = verdict.passed && toolErrors.length === 0;
    if (!isPassing) failures++;
    console.log(`[selfTest] ${task.id} ${version}: ${isPassing ? "PASS" : "FAIL"} (${verdict.reason}${toolErrors.length > 0 ? `; ${toolErrors.join(" | ")}` : ""})`);
  }
}
const isRejectionCorrect = checkRejectsTextOnPinterest();
if (!isRejectionCorrect) failures++;
console.log(`[selfTest] text post on Pinterest rejected: ${isRejectionCorrect ? "PASS" : "FAIL"}`);
console.log(`[selfTest] ${failures === 0 ? "all checks pass" : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
