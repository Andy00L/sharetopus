import "server-only";

/**
 * Queries the Inngest REST API for runs associated with a given event ID.
 *
 * Endpoint: GET https://api.inngest.com/v1/events/{event_id}/runs
 * Auth: Bearer <INNGEST_SIGNING_KEY>
 *
 * Returns: normalized run statuses or an error.
 * Persists: nothing (read-only).
 */

export type InngestRunStatus =
  | "Running"
  | "Completed"
  | "Failed"
  | "Cancelled"
  | "Scheduled"
  | "Unknown";

export type InngestRun = {
  run_id: string;
  status: InngestRunStatus;
  output: unknown;
};

export type RunStatusResult =
  | { success: true; runs: InngestRun[] }
  | { success: false; message: string };

const INNGEST_API_BASE = "https://api.inngest.com/v1";

export async function queryEventRunStatus(
  eventId: string
): Promise<RunStatusResult> {
  const signingKey = process.env.INNGEST_SIGNING_KEY;
  if (!signingKey) {
    console.error(
      "[queryEventRunStatus] INNGEST_SIGNING_KEY not configured"
    );
    return {
      success: false,
      message: "INNGEST_SIGNING_KEY not configured",
    };
  }

  try {
    const url = `${INNGEST_API_BASE}/events/${encodeURIComponent(eventId)}/runs`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${signingKey}`,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[queryEventRunStatus] Inngest API returned ${res.status}: ${body}`
      );
      return {
        success: false,
        message: `Inngest API error ${res.status}`,
      };
    }

    const json = await res.json();

    // The API returns { data: Run[] } or a bare array. Handle both.
    const rawRuns: unknown[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.data)
        ? json.data
        : [];

    const runs: InngestRun[] = rawRuns.map((r: unknown) => {
      const run = r as Record<string, unknown>;
      return {
        run_id: String(run.run_id ?? run.id ?? ""),
        status: normalizeStatus(run.status),
        output: run.output ?? null,
      };
    });

    return { success: true, runs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[queryEventRunStatus] Fetch failed:", message);
    return { success: false, message: `Fetch failed: ${message}` };
  }
}

function normalizeStatus(raw: unknown): InngestRunStatus {
  if (typeof raw === "string") {
    const lower = raw.toLowerCase();
    if (lower === "running") return "Running";
    if (lower === "completed") return "Completed";
    if (lower === "failed") return "Failed";
    if (lower === "cancelled") return "Cancelled";
    if (lower === "scheduled") return "Scheduled";
  }
  // Inngest Go source uses numeric enums; handle them defensively
  if (typeof raw === "number") {
    const map: Record<number, InngestRunStatus> = {
      0: "Running",
      1: "Completed",
      2: "Failed",
      3: "Cancelled",
      5: "Scheduled",
    };
    return map[raw] ?? "Unknown";
  }
  return "Unknown";
}
