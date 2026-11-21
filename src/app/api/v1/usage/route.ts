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

export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.usage.get",
  handler: async (ctx) => {
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

    const actionCounts: Record<string, number> = {};
    for (const row of usageRows) {
      actionCounts[row.action] = row.count;
    }

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
