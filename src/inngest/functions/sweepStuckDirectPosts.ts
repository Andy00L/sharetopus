import { inngest } from "@/inngest/client";
import {
  findStuckPendingDirectPosts,
  sweepStuckPendingDirectPosts,
  SWEPT_DIRECT_POST_REASON,
  type SweptDirectPost,
} from "@/actions/server/data/pendingDirectPosts";
import { dispatchWebhooks } from "@/lib/api/rest/webhooks/dispatch";
import {
  buildDispatchFailedPayload,
  type PostFailure,
} from "@/lib/api/rest/webhooks/postWebhookPayloads";

const STUCK_AGE_MS = 60 * 60 * 1000;

const SWEPT_CLAIMED_FAILURE: PostFailure = {
  reason: "unknown",
  message: SWEPT_DIRECT_POST_REASON,
  mayHavePublished: true,
};

const SWEPT_UNCLAIMED_FAILURE: PostFailure = {
  reason: "unknown",
  message: "Publishing never started before the hourly sweep; the post was not published",
  mayHavePublished: false,
};

function describeSweptFailure(sweptDispatch: SweptDirectPost): PostFailure {
  return sweptDispatch.publish_started_at === null ? SWEPT_UNCLAIMED_FAILURE : SWEPT_CLAIMED_FAILURE;
}

function groupByPrincipal(sweptDispatches: SweptDirectPost[]): Map<string, SweptDirectPost[]> {
  const dispatchesByPrincipal = new Map<string, SweptDirectPost[]>();
  for (const sweptDispatch of sweptDispatches) {
    const principalDispatches = dispatchesByPrincipal.get(sweptDispatch.principal_id) ?? [];
    principalDispatches.push(sweptDispatch);
    dispatchesByPrincipal.set(sweptDispatch.principal_id, principalDispatches);
  }
  return dispatchesByPrincipal;
}

async function notifySweptDispatches(sweptDispatches: SweptDirectPost[]): Promise<void> {
  await Promise.all(
    [...groupByPrincipal(sweptDispatches)].map(([principalId, principalDispatches]) =>
      dispatchWebhooks(
        principalId,
        "post.failed",
        principalDispatches.map((sweptDispatch) =>
          buildDispatchFailedPayload(sweptDispatch, describeSweptFailure(sweptDispatch)),
        ),
      ),
    ),
  );
}

// Inngest marks a run failed and retries it only when the step throws:
// https://www.inngest.com/docs/guides/error-handling
export const sweepStuckDirectPosts = inngest.createFunction(
  {
    id: "sweep-stuck-direct-posts",
    name: "Sweep stuck pending_direct_posts",
    retries: 2,
    triggers: [{ cron: "15 * * * *" }],
  },
  async ({ step }) => {
    const stuck = await step.run("find-stuck-dispatches", async () => {
      const nowMs = Date.now();
      const cutoffIso = new Date(nowMs - STUCK_AGE_MS).toISOString();
      const found = await findStuckPendingDirectPosts(cutoffIso);
      if (!found.success) throw new Error(`sweep-failure: ${found.message}`);
      return { dispatchIds: found.dispatchIds, cutoffIso, sweptAtIso: new Date(nowMs).toISOString() };
    });
    if (stuck.dispatchIds.length === 0) return { swept: 0, cutoffIso: stuck.cutoffIso };

    const sweptDispatches = await step.run("mark-stuck-dispatches-failed", async () => {
      const swept = await sweepStuckPendingDirectPosts(stuck);
      if (!swept.success) throw new Error(`sweep-failure: ${swept.message}`);
      console.log(
        `[sweepStuckDirectPosts] Swept ${swept.sweptDispatches.length} stuck rows older than ${stuck.cutoffIso}`,
      );
      return swept.sweptDispatches;
    });

    if (sweptDispatches.length > 0) {
      await step.run("notify-swept-dispatches", () => notifySweptDispatches(sweptDispatches));
    }
    return { swept: sweptDispatches.length, cutoffIso: stuck.cutoffIso };
  },
);
