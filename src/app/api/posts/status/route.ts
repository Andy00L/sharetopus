import "server-only";

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import type {
  PostStatusJob,
  PostStatusJobStatus,
  PostStatusResponse,
} from "@/lib/types/postStatus";
import { isJobTerminal } from "@/lib/types/postStatus";

export const runtime = "nodejs";

/**
 * Maps the DB status enum ("processing"|"completed"|"failed") to the
 * public API values ("pending"|"success"|"failed"). The public shape
 * is unchanged from the Inngest-backed version so existing clients
 * keep working.
 */
function mapDbStatusToPublic(
  dbStatus: "processing" | "completed" | "failed",
): PostStatusJobStatus {
  if (dbStatus === "completed") return "success";
  if (dbStatus === "failed") return "failed";
  return "pending";
}

/**
 * GET /api/posts/status?event_ids=evt1,evt2,evt3
 *
 * Returns the current status of every event_id requested, scoped to
 * the authenticated user. Backed by pending_direct_posts which the
 * direct-post worker maintains via finalizePendingDirectPost.
 *
 * Previously queried Inngest's REST API per event_id. Switched to the
 * local DB to remove N external HTTP calls per poll iteration.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    const body: PostStatusResponse = {
      success: false,
      message: "Unauthorized.",
    };
    return NextResponse.json(body, { status: 401 });
  }

  const rateCheck = await checkRateLimit(
    "postsStatusPoll",
    userId,
    240,
    60,
    undefined,
  );
  if (!rateCheck.success) {
    const body: PostStatusResponse = {
      success: false,
      message: "Too many status checks. Please slow down.",
    };
    return NextResponse.json(body, { status: 429 });
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
    .map((s) => s.trim())
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

  const { data, error } = await adminSupabase
    .from("pending_direct_posts")
    .select("event_id, status, platform, failure_reason")
    .in("event_id", eventIds)
    .eq("principal_id", userId);

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

  // Build a row lookup keyed by event_id. Missing event_ids are
  // treated as still "pending" (lock row insert and Inngest send are
  // sequential but not transactional; a rare race could leave a row
  // momentarily missing).
  const rowByEventId = new Map(
    (data ?? []).map((row) => [row.event_id, row]),
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

  const allTerminal = jobs.every((j) => isJobTerminal(j.status));

  const body: PostStatusResponse = {
    success: true,
    jobs,
    allTerminal,
  };
  return NextResponse.json(body);
}
