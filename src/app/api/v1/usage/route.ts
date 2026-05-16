import { NextResponse } from "next/server";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { buildUsageDTO } from "@/lib/api/rest/dto/toUsageDTO";
import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { currentQuotaPeriod } from "@/lib/mcp/_shared/currentQuotaPeriod";
import { adminSupabase } from "@/actions/api/adminSupabase";

/**
 * GET /v1/usage -- current month quotas + storage usage.
 *
 * Mirrors the MCP list_billing_summary output minus Stripe-internal
 * fields. Combines checkActiveSubscription, usage_quotas, and
 * get_user_storage_bytes RPC.
 */
export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.usage.get",
  handler: async (ctx) => {
    // Step 1: resolve subscription status.
    const subscription = await checkActiveSubscription(
      ctx.principal.principalId,
    );

    // Step 2: fetch current month usage quotas.
    const periodFilter = currentQuotaPeriod();
    const { data: usageRows, error: usageError } = await adminSupabase
      .from("usage_quotas")
      .select("action, count")
      .eq("principal_id", ctx.principal.principalId)
      .eq("period", periodFilter);

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
    for (const row of usageRows ?? []) {
      actionCounts[row.action] = row.count;
    }

    // Step 3: get storage usage via RPC.
    const storageBucket =
      process.env.SUPABASE_BUCKET_NAME ?? "scheduled-videos";
    const { data: storageBytes, error: storageError } =
      await adminSupabase.rpc("get_user_storage_bytes", {
        _bucket: storageBucket,
        _prefix: `${ctx.principal.principalId}/`,
      });

    if (storageError) {
      console.error(
        `[v1/usage GET] storage RPC failed (request_id=${ctx.requestId}):`,
        storageError.message,
      );
      // Non-fatal: default to 0 bytes if RPC fails.
    }

    const storageUsedBytes =
      typeof storageBytes === "number" ? storageBytes : 0;

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
