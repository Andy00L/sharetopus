import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { scheduledPostsTick } from "@/inngest/functions/scheduledPostsTick";
import { processSinglePost } from "@/inngest/functions/processSinglePost";
import { processDirectPost } from "@/inngest/functions/processDirectPost";
import { tikTokPublishStatusPollWorker } from "@/inngest/functions/tikTokPublishStatusPoll";
import { sweepStuckDirectPosts } from "@/inngest/functions/sweepStuckDirectPosts";

export const runtime = "nodejs";

/**
 * MUST equal RUNTIME.maxDurationS. Vercel cannot read expressions
 * at build time, so this is a literal. If RUNTIME.maxDurationS is
 * raised, update this literal to match.
 */
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [scheduledPostsTick, processSinglePost, processDirectPost, tikTokPublishStatusPollWorker, sweepStuckDirectPosts],
});
