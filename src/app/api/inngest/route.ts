import { inngest } from "@/inngest/client";
import { cleanupCancelledPostsAfterGraceCron } from "@/inngest/functions/cleanupCancelledPostsAfterGraceCron";
import { cleanupMcpAuditLogCron } from "@/inngest/functions/cleanupMcpAuditLogCron";
import { cleanupSocialConnectionsCron } from "@/inngest/functions/cleanupSocialConnectionsCron";
import { cleanupX402AccessLogCron } from "@/inngest/functions/cleanupX402AccessLogCron";
import { cleanupStripeWebhookEvents } from "@/inngest/functions/cleanupStripeWebhookEvents";
import { processDirectPost } from "@/inngest/functions/processDirectPost";
import { processSinglePost } from "@/inngest/functions/processSinglePost";
import { scheduledPostsTick } from "@/inngest/functions/scheduledPostsTick";
import { sweepOrphanStorageFiles } from "@/inngest/functions/sweepOrphanStorageFiles";
import { sweepStaleOauthClientsCron } from "@/inngest/functions/sweepStaleOauthClientsCron";
import { sweepStuckDirectPosts } from "@/inngest/functions/sweepStuckDirectPosts";
import { processTikTokPublishWebhook } from "@/inngest/functions/processTikTokPublishWebhook";
import { tikTokPublishStatusPollWorker } from "@/inngest/functions/tikTokPublishStatusPoll";
import { deliverWebhook } from "@/inngest/functions/deliverWebhook";
import { serve } from "inngest/next";

export const runtime = "nodejs";

/**
 * MUST equal RUNTIME.maxDurationS. Vercel cannot read expressions
 * at build time, so this is a literal. If RUNTIME.maxDurationS is
 * raised, update this literal to match.
 */
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    scheduledPostsTick,
    processSinglePost,
    processDirectPost,
    tikTokPublishStatusPollWorker,
    processTikTokPublishWebhook,
    sweepStuckDirectPosts,
    sweepOrphanStorageFiles,
    sweepStaleOauthClientsCron,
    cleanupCancelledPostsAfterGraceCron,
    cleanupStripeWebhookEvents,
    cleanupMcpAuditLogCron,
    cleanupSocialConnectionsCron,
    cleanupX402AccessLogCron,
    deliverWebhook,
  ],
});
