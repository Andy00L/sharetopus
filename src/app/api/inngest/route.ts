import { inngest } from "@/inngest/client";
import { cleanupCancelledPostsAfterGraceCron } from "@/inngest/functions/cleanupCancelledPostsAfterGraceCron";
import { cleanupMcpAuditLogCron } from "@/inngest/functions/cleanupMcpAuditLogCron";
import { cleanupRestAuditLogCron } from "@/inngest/functions/cleanupRestAuditLogCron";
import { cleanupSocialConnectionsCron } from "@/inngest/functions/cleanupSocialConnectionsCron";
import { cleanupTikTokWebhookEventsCron } from "@/inngest/functions/cleanupTikTokWebhookEventsCron";
import { cleanupX402AccessLogCron } from "@/inngest/functions/cleanupX402AccessLogCron";
import { cleanupStripeWebhookEvents } from "@/inngest/functions/cleanupStripeWebhookEvents";
import { encryptSocialTokensCron } from "@/inngest/functions/encryptSocialTokensCron";
import { processDirectPost } from "@/inngest/functions/processDirectPost";
import { processSinglePost } from "@/inngest/functions/processSinglePost";
import { scheduledPostsTick } from "@/inngest/functions/scheduledPostsTick";
import { sweepOrphanStorageFiles } from "@/inngest/functions/sweepOrphanStorageFiles";
import { sweepStaleOauthClientsCron } from "@/inngest/functions/sweepStaleOauthClientsCron";
import { sweepStuckDirectPosts } from "@/inngest/functions/sweepStuckDirectPosts";
import { sweepX402ReconciliationCron } from "@/inngest/functions/sweepX402ReconciliationCron";
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
    cleanupRestAuditLogCron,
    cleanupSocialConnectionsCron,
    cleanupTikTokWebhookEventsCron,
    cleanupX402AccessLogCron,
    sweepX402ReconciliationCron,
    encryptSocialTokensCron,
    deliverWebhook,
  ],
});
