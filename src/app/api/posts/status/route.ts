import { queryEventRunStatus } from "@/lib/api/inngest/queryRunStatus";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type JobStatus = {
  event_id: string;
  status: "pending" | "success" | "failed";
  error_message?: string;
};

type StatusResponse =
  | {
      success: true;
      jobs: JobStatus[];
      allTerminal: boolean;
    }
  | { success: false; message: string };

/**
 * GET /api/posts/status?event_ids=evt_1,evt_2,evt_3
 *
 * Polls the Inngest API for run states of direct-post events.
 * Requires Clerk auth.
 */
export async function GET(
  req: NextRequest,
): Promise<NextResponse<StatusResponse>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { success: false, message: "Not authenticated" },
      { status: 401 },
    );
  }

  const eventIdsParam = req.nextUrl.searchParams.get("event_ids");
  if (!eventIdsParam) {
    return NextResponse.json(
      { success: false, message: "Missing event_ids parameter" },
      { status: 400 },
    );
  }

  const eventIds = eventIdsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (eventIds.length === 0) {
    return NextResponse.json(
      { success: false, message: "No event IDs provided" },
      { status: 400 },
    );
  }

  if (eventIds.length > 50) {
    return NextResponse.json(
      { success: false, message: "Too many event IDs (max 50)" },
      { status: 400 },
    );
  }

  const jobs: JobStatus[] = [];

  // Fan out queries in parallel
  const results = await Promise.all(
    eventIds.map((eventId) => queryEventRunStatus(eventId)),
  );

  for (let i = 0; i < eventIds.length; i++) {
    const eventId = eventIds[i];
    const result = results[i];

    if (!result.success) {
      // Inngest API error for this event; treat as pending (may be transient)
      console.warn(
        `[postsStatus] Failed to query event ${eventId}: ${result.message}`,
      );
      jobs.push({ event_id: eventId, status: "pending" });
      continue;
    }

    if (result.runs.length === 0) {
      // No runs yet; event may still be queued
      jobs.push({ event_id: eventId, status: "pending" });
      continue;
    }

    // For direct posts there is one run per event
    const run = result.runs[0];

    if (run.status === "Completed") {
      const output = run.output as Record<string, unknown> | null;
      const explicitlyFailed = output?.ok === false;
      if (explicitlyFailed) {
        const errorMsg =
          typeof output?.message === "string" ? output.message : "Post failed";
        jobs.push({
          event_id: eventId,
          status: "failed",
          error_message: errorMsg,
        });
      } else {
        jobs.push({ event_id: eventId, status: "success" });
      }
    } else if (run.status === "Failed" || run.status === "Cancelled") {
      jobs.push({
        event_id: eventId,
        status: "failed",
        error_message: `Run ${run.status.toLowerCase()}`,
      });
    } else {
      // Running, Scheduled, Unknown
      jobs.push({ event_id: eventId, status: "pending" });
    }
  }

  const allTerminal = jobs.every(
    (j) => j.status === "success" || j.status === "failed",
  );

  return NextResponse.json({ success: true, jobs, allTerminal });
}
