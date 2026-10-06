// The eval tasks. Each check reads the mock world after the run (or the final answer for
// read-only questions), so the same check grades both tool sets.
import { ACCOUNT_IDS, FALL_BOARD_ID, SEED_POST_IDS, type MockPost, type MockWorld } from "./mockWorld";

export type CheckResult = { passed: boolean; reason: string };

export type EvalTask = {
  id: string;
  prompt: string;
  check: (world: MockWorld, finalText: string) => CheckResult;
};

const pass = (reason: string): CheckResult => ({ passed: true, reason });
const fail = (reason: string): CheckResult => ({ passed: false, reason });

function newPostsOf(world: MockWorld): MockPost[] {
  return world.posts.filter((post) => !post.isSeed);
}

function findSeedPost(world: MockWorld, postId: string): MockPost | undefined {
  return world.posts.find((post) => post.id === postId);
}

function isSameInstant(left: string | null, right: string): boolean {
  return left !== null && Date.parse(left) === Date.parse(right);
}

function mentionsAll(finalText: string, phrases: string[]): boolean {
  const lowerText = finalText.toLowerCase();
  return phrases.every((phrase) => lowerText.includes(phrase.toLowerCase()));
}

export const EVAL_TASKS: EvalTask[] = [
  {
    id: "text-now",
    prompt: "Post 'We ship on Friday' to my Bluesky account right now.",
    check: (world) => {
      const created = newPostsOf(world);
      const bluesky = created.filter((post) => post.accountId === ACCOUNT_IDS.bluesky && post.status === "published");
      if (created.length !== 1 || bluesky.length !== 1) return fail(`expected 1 new published Bluesky post, got ${created.length} new posts`);
      return bluesky[0]?.text?.includes("We ship on Friday") ? pass("published once") : fail("wrong text");
    },
  },
  {
    id: "cross-post-media",
    prompt:
      "Schedule this photo https://cdn.example.com/fall.jpg on Pinterest (my Fall Launch board) and on LinkedIn for Thursday October 8 at 10:00 Toronto time (UTC-4), caption 'Fall launch is here'.",
    check: (world) => {
      const created = newPostsOf(world);
      const pinterest = created.find((post) => post.accountId === ACCOUNT_IDS.pinterest);
      const linkedin = created.find((post) => post.accountId === ACCOUNT_IDS.linkedin);
      if (created.length !== 2 || !pinterest || !linkedin) return fail(`expected 2 new posts (Pinterest, LinkedIn), got ${created.length}`);
      for (const post of [pinterest, linkedin]) {
        if (post.status !== "scheduled" || !isSameInstant(post.scheduledAt, "2026-10-08T14:00:00Z")) return fail(`${post.platform} not scheduled at 14:00Z (${post.scheduledAt})`);
        if (post.mediaType !== "image" || !post.mediaPath) return fail(`${post.platform} has no image`);
      }
      return pinterest.boardId === FALL_BOARD_ID ? pass("both scheduled with the image") : fail("wrong Pinterest board");
    },
  },
  {
    id: "cancel-friday",
    prompt: "Cancel every post I have scheduled for Friday October 9.",
    check: (world) => {
      const fridayTips = findSeedPost(world, SEED_POST_IDS.fridayTips);
      const fridayStream = findSeedPost(world, SEED_POST_IDS.fridayStream);
      const midWeek = findSeedPost(world, SEED_POST_IDS.midWeekRecap);
      if (fridayTips?.status !== "cancelled" || fridayStream?.status !== "cancelled") return fail("a Friday post is not cancelled");
      if (midWeek?.status !== "scheduled") return fail("a non-Friday post changed");
      return newPostsOf(world).length === 0 ? pass("both Friday posts cancelled") : fail("created posts");
    },
  },
  {
    id: "reschedule-friday",
    prompt: "Move all my posts scheduled for Friday October 9 to Monday October 12 at 09:00 UTC.",
    check: (world) => {
      const moved = [SEED_POST_IDS.fridayTips, SEED_POST_IDS.fridayStream].map((postId) => findSeedPost(world, postId));
      const isEveryPostMoved = moved.every((post) => post?.status === "scheduled" && isSameInstant(post.scheduledAt, "2026-10-12T09:00:00Z"));
      if (!isEveryPostMoved) return fail("a Friday post is not at 2026-10-12T09:00Z");
      const midWeek = findSeedPost(world, SEED_POST_IDS.midWeekRecap);
      return isSameInstant(midWeek?.scheduledAt ?? null, "2026-10-14T13:00:00Z") ? pass("both moved") : fail("a non-Friday post moved");
    },
  },
  {
    id: "needs-reconnect",
    prompt: "Which of my connected accounts need to be reconnected, and where do I do it?",
    check: (_world, finalText) =>
      mentionsAll(finalText, ["tiktok", "sharetopus.com/connections"]) ? pass("named TikTok and the URL") : fail("answer misses TikTok or the reconnect URL"),
  },
  {
    id: "linkedin-history",
    prompt: "What did I publish on LinkedIn this month? List the posts.",
    check: (_world, finalText) =>
      mentionsAll(finalText, ["launch week recap", "postgres"]) ? pass("listed both posts") : fail("answer misses a published post"),
  },
  {
    id: "delete-old-promo",
    prompt: "Permanently delete my cancelled post about the old promo.",
    check: (world) => {
      if (!world.deletedPostIds.includes(SEED_POST_IDS.oldPromo)) return fail("old promo still exists");
      return world.deletedPostIds.length === 1 ? pass("deleted only the promo") : fail(`deleted ${world.deletedPostIds.length} posts`);
    },
  },
  {
    id: "broadcast-text",
    prompt: "Post 'Hello from Sharetopus' right now to every account of mine that can take a text post.",
    check: (world) => {
      const created = newPostsOf(world);
      const targetedIds = new Set(created.map((post) => post.accountId));
      const isExactTargets = targetedIds.size === 2 && targetedIds.has(ACCOUNT_IDS.linkedin) && targetedIds.has(ACCOUNT_IDS.bluesky);
      if (!isExactTargets || created.length !== 2) return fail(`expected LinkedIn and Bluesky once each, got ${created.map((post) => post.platform).join(", ") || "nothing"}`);
      return created.every((post) => post.status === "published") ? pass("posted to LinkedIn and Bluesky") : fail("a post was scheduled, not published");
    },
  },
];
