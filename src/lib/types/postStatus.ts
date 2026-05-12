/**
 * Shared response types for GET /api/posts/status.
 *
 * Imported by the route handler (server) and the client polling util
 * to keep the response contract in one place.
 *
 * The public API exposes "pending" | "success" | "failed".
 * The DB column (pending_direct_posts.status) stores
 * "processing" | "completed" | "failed". The route maps at the
 * boundary; see mapDbStatusToPublic in route.ts.
 */

/**
 * Public status values returned to the client.
 * "pending" = still in progress, "success" = done, "failed" = error.
 */
export type PostStatusJobStatus = "pending" | "success" | "failed";

/**
 * Single job entry in the status response.
 */
export type PostStatusJob = {
  event_id: string;
  status: PostStatusJobStatus;
  platform: string;
  error_message: string | null;
};

/**
 * Discriminated response shape returned by GET /api/posts/status.
 */
export type PostStatusResponse =
  | {
      success: true;
      jobs: PostStatusJob[];
      allTerminal: boolean;
    }
  | {
      success: false;
      message: string;
    };

/**
 * True if the status has reached a terminal state.
 */
export function isJobTerminal(status: PostStatusJobStatus): boolean {
  return status === "success" || status === "failed";
}
