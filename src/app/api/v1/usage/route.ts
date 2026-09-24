import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { buildUsageDTO } from "@/lib/api/rest/dto/toUsageDTO";
import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { currentQuotaPeriod } from "@/lib/mcp/_shared/currentQuotaPeriod";
import { getUserStorageBytes } from "@/lib/storage/getUserStorageBytes";
import { db, runQuery } from "@/db/client";
import { usage_quotas } from "@/db/schema";

/**
 * GET /v1/usage -- current month quotas + storage usage.
 *
 * Mirrors the MCP list_billing_summary output minus Stripe-internal
 * fields. Combines checkActiveSubscription, usage_quotas, and
 * getUserStorageBytes. Any of the three failing answers 500: a failed read
 * reported as "no plan" or "0 bytes" looks like real data.
 */
export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.usage.get",
  handler: async (ctx) => {
    // Step 1: resolve subscription status.
    const subscription = await checkActiveSubscription(
      ctx.principal.principalId,
    );
    if (subscription.status === "unavailable") {
      return restErrorResponse(
        "internal_error",
        "Subscription lookup failed",
        ctx.requestId,
      );
    }

    // Step 2: fetch current month usage quotas.
    const periodFilter = currentQuotaPeriod();
    const { data: usageRows, error: usageError } = await runQuery(
      db
        .select({ action: usage_quotas.action, count: usage_quotas.count })
        .from(usage_quotas)
        .where(
          and(
            eq(usage_quotas.principal_id, ctx.principal.principalId),
            eq(usage_quotas.period, periodFilter),
          ),
        ),
    );

    if (usageError) {
      console.error(
        `[v1/usage GET] usage_quotas query failed (request_id=${ctx.requestId}):`,
        usageError.message,
      );
      return restErrorResponse(
        "internal_error",
        "Usage query failed",
        ctx.requestId,
      );
    }

    // Build action -> count map.
    const actionCounts: Record<string, number> = {};
    for (const row of usageRows) {
      actionCounts[row.action] = row.count;
    }

    // Step 3: storage usage, read the way the MCP and x402 quota checks do.
    const storageUsage = await getUserStorageBytes(ctx.principal.principalId);
    if (!storageUsage.success) {
      console.error(
        `[v1/usage GET] storage read failed (request_id=${ctx.requestId}):`,
        storageUsage.message,
      );
      return restErrorResponse(
        "internal_error",
        "Storage usage query failed",
        ctx.requestId,
      );
    }
    const storageUsedBytes = storageUsage.currentBytes;

    // Step 4: build DTO.
    const usageDto = buildUsageDTO({
      tier: subscription.tier,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      period: periodFilter,
      actionCounts,
      storageUsedBytes,
    });

    return {
      response: NextResponse.json(usageDto, {
        status: 200,
        headers: { "x-request-id": ctx.requestId },
      }),
      auditSummary: {
        plan: usageDto.plan,
        action_count: Object.keys(actionCounts).length,
        storage_bytes_used: storageUsedBytes,
      },
    };
  },
});
