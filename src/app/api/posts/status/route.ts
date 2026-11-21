import "server-only";

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { pending_direct_posts } from "@/db/schema";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { POSTS_STATUS_POLL_RATE_LIMIT } from "@/actions/server/rateLimit/rateLimitRules";
import type {
  PostStatusJob,
  PostStatusJobStatus,
  PostStatusResponse,
} from "@/lib/types/postStatus";
import { isJobTerminal } from "@/lib/types/postStatus";

export const runtime = "nodejs";

function mapDbStatusToPublic(
  dbStatus: "processing" | "completed" | "failed",
): PostStatusJobStatus {
  if (dbStatus === "completed") return "success";
  if (dbStatus === "failed") return "failed";
  return "pending";
}

export async function GET(request: Request): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    const body: PostStatusResponse = {
      success: false,
      message: "Unauthorized.",
    };
    return NextResponse.json(body, { status: 401 });
  }

  const rateCheck = await checkRateLimit({
    operation: "postsStatusPoll",
    identifier: userId,
    rule: POSTS_STATUS_POLL_RATE_LIMIT,
  });
  if (!rateCheck.success) {
    const body: PostStatusResponse = {
      success: false,
      message: rateCheck.message,
    };
    return NextResponse.json(body, {
      status: rateCheck.reason === "limited" ? 429 : 503,
    });
  }

  const url = new URL(request.url);
  const raw = url.searchParams.get("event_ids");
  if (!raw) {
    const body: PostStatusResponse = {
      success: false,
      message: "event_ids query parameter is required.",
    };
    return NextResponse.json(body, { status: 400 });
  }

  const eventIds = raw
    .split(",")
    .map((rawEventId) => rawEventId.trim())
    .filter(Boolean);

  if (eventIds.length === 0) {
    const body: PostStatusResponse = {
      success: true,
      jobs: [],
      allTerminal: true,
    };
    return NextResponse.json(body);
  }

  if (eventIds.length > 100) {
    const body: PostStatusResponse = {
      success: false,
      message: "Too many event_ids in a single request.",
    };
    return NextResponse.json(body, { status: 400 });
  }

  const { data: statusRows, error } = await runQuery(
    db
      .select({
        event_id: pending_direct_posts.event_id,
        status: pending_direct_posts.status,
        platform: pending_direct_posts.platform,
        failure_reason: pending_direct_posts.failure_reason,
      })
      .from(pending_direct_posts)
      .where(
        and(
          inArray(pending_direct_posts.event_id, eventIds),
          eq(pending_direct_posts.principal_id, userId),
        ),
      ),
  );

  if (error) {
    console.error(
      `[postsStatusRoute] DB query failed for ${eventIds.length} event(s): ${error.message}`,
    );
    const body: PostStatusResponse = {
      success: false,
      message: "Failed to read post status.",
    };
    return NextResponse.json(body, { status: 500 });
  }

  const rowByEventId = new Map(
    statusRows.map((row) => [row.event_id, row]),
  );

  const jobs: PostStatusJob[] = eventIds.map((eventId) => {
    const row = rowByEventId.get(eventId);
    if (!row) {
      return {
        event_id: eventId,
        status: "pending" as const,
        platform: "unknown",
        error_message: null,
      };
    }
    return {
      event_id: row.event_id,
      status: mapDbStatusToPublic(row.status),
      platform: row.platform,
      error_message: row.failure_reason ?? null,
    };
  });

  const allTerminal = jobs.every((job) => isJobTerminal(job.status));

  const body: PostStatusResponse = {
    success: true,
    jobs,
    allTerminal,
  };
  return NextResponse.json(body);
}
